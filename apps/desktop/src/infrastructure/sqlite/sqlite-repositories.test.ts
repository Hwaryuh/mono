import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createMockPlatformState, type MockPlatformState } from "../mock/mock-platform-state";
import { InMemoryMediaStore } from "../media/media-store";
import type { PlatformStateStore } from "./platform-state-store";
import { createSqliteRepositories } from "./sqlite-repositories";

class RestartableStateStore implements PlatformStateStore {
  state: MockPlatformState | null = null;
  saveCount = 0;
  failNextSave = false;

  async load() {
    return this.state === null ? null : structuredClone(this.state);
  }

  async save(state: MockPlatformState) {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("테스트 저장 실패");
    }
    this.state = structuredClone(state);
    this.saveCount += 1;
  }
}

describe("SQLite Repository 조립", () => {
  // 코디네이터가 실제 시계로 today를 새기므로, 날짜 의존 단언은 시계를 고정해 결정적으로 만든다.
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 5));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it("빈 저장소를 한 번 시드한다", async () => {
    const store = new RestartableStateStore();

    const repositories = await createSqliteRepositories(store, new InMemoryMediaStore());

    expect(store.saveCount).toBe(1);
    expect((await repositories.inboxRepository.getSnapshot()).items).toHaveLength(5);
  });

  it("핵심 데이터가 Repository 재조립 뒤에도 유지된다", async () => {
    const store = new RestartableStateStore();
    const first = await createSqliteRepositories(store, new InMemoryMediaStore());

    await first.dashboardRepository.capture({ raw: "재실행 뒤 수집함 확인" });
    await first.todoRepository.create({
      title: "재실행 뒤 할 일 확인",
      labelId: "work",
      dueDate: "2026-08-06",
      dueTime: null,
      note: "",
    });
    await first.routineRepository.toggleToday("routine-2");
    await first.calendarRepository.create({
      title: "재실행 뒤 일정 확인",
      startDate: "2026-08-06",
      startTime: "09:00",
      endDate: "2026-08-06",
      endTime: "10:00",
      location: "",
      categoryId: "work",
      note: "",
    });
    await first.scrapRepository.create({
      title: "재실행 뒤 스크랩 확인",
      memo: "",
      url: "",
      tag: "수집",
    });
    await first.ledgerRepository.create({
      title: "재실행 뒤 지출 확인",
      amountWon: 2_000,
      date: "2026-08-05",
      categoryId: "other",
      note: "",
    });

    const restarted = await createSqliteRepositories(store, new InMemoryMediaStore());

    expect((await restarted.inboxRepository.getSnapshot()).items[0].raw).toBe("재실행 뒤 수집함 확인");
    expect((await restarted.todoRepository.getSnapshot()).items.some((item) => item.title === "재실행 뒤 할 일 확인")).toBe(true);
    expect((await restarted.routineRepository.getSnapshot()).occurrences).toContainEqual(expect.objectContaining({
      routineId: "routine-2",
      occurrenceDate: "2026-08-05",
      done: true,
    }));
    expect((await restarted.calendarRepository.getSnapshot()).events[0].title).toBe("재실행 뒤 일정 확인");
    expect((await restarted.scrapRepository.getSnapshot()).items[0].title).toBe("재실행 뒤 스크랩 확인");
    expect((await restarted.ledgerRepository.getSnapshot()).expenses[0]).toMatchObject({ title: "재실행 뒤 지출 확인", amountWon: 2_000 });
    expect((await restarted.dashboardRepository.getSnapshot()).monthlyExpense.total).toBe(611_200);
  });

  it("정규화가 idempotent해서 재부팅 때 다시 저장하지 않는다", async () => {
    const store = new RestartableStateStore();
    await createSqliteRepositories(store, new InMemoryMediaStore()); // 시드 저장 1회

    await createSqliteRepositories(store, new InMemoryMediaStore()); // 재부팅
    await createSqliteRepositories(store, new InMemoryMediaStore()); // 재부팅

    expect(store.saveCount).toBe(1);
  });

  it("저장 실패 시 메모리 상태도 커밋하지 않는다", async () => {
    const store = new RestartableStateStore();
    const repositories = await createSqliteRepositories(store, new InMemoryMediaStore());
    store.failNextSave = true;

    await expect(repositories.todoRepository.create({
      title: "저장되면 안 되는 할 일",
      labelId: "work",
      dueDate: null,
      dueTime: null,
      note: "",
    })).rejects.toThrow("테스트 저장 실패");

    expect((await repositories.todoRepository.getSnapshot()).items.some((item) => item.title === "저장되면 안 되는 할 일")).toBe(false);
  });

  it("기존 SQLite의 HEX 색상을 로드하며 OKLCH로 저장 마이그레이션한다", async () => {
    const store = new RestartableStateStore();
    const legacyState = createMockPlatformState();
    delete (legacyState as { stateVersion?: number }).stateVersion; // 버전 태그 이전의 레거시 blob
    legacyState.todo.labels[0].color = "#3f7d5e";
    store.state = legacyState;

    const repositories = await createSqliteRepositories(store, new InMemoryMediaStore());

    expect(store.saveCount).toBe(1);
    expect((await repositories.todoRepository.getSnapshot()).labels[0].color).toBe("oklch(0.539 0.082 160.129)");
    expect(store.state?.todo.labels[0].color).toBe("oklch(0.539 0.082 160.129)");
  });

  it("부팅 시 참조되지 않는 미디어는 지우고 참조 중인 미디어는 남긴다", async () => {
    const store = new RestartableStateStore();
    const seed = createMockPlatformState();
    seed.inbox.items = [{
      id: "inbox-media-1",
      source: "image",
      raw: "사진",
      target: "scrap",
      confidence: 1,
      status: "pending",
      pinned: false,
      receivedAt: "방금",
      fields: [],
      images: [{ name: "photo.png", mimeType: "image/png", size: 4, mediaId: "referenced-media" }],
    }];
    store.state = seed;
    const mediaStore = new InMemoryMediaStore();
    await mediaStore.save("orphan-media", "data:image/png;base64,AAAA");
    await mediaStore.save("referenced-media", "data:image/png;base64,BBBB");

    await createSqliteRepositories(store, mediaStore);

    // GC는 부팅 시 fire-and-forget이라 완료를 기다려야 한다(실패해도 부팅을 막지 않기 위함).
    await vi.waitFor(async () => {
      expect(await mediaStore.load("orphan-media")).toBeNull();
    });
    expect(await mediaStore.load("referenced-media")).toBe("data:image/png;base64,BBBB");
  });
});
