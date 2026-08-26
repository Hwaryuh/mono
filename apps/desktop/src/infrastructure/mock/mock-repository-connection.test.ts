import { describe, expect, it } from "vitest";
import { createMockDashboardRepository } from "./mock-dashboard-repository";
import { createMockInboxRepository } from "./mock-inbox-repository";
import { createMockPlatformState } from "./mock-platform-state";
import { createMockTodoRepository } from "./mock-todo-repository";
import { createMockCalendarRepository } from "./mock-calendar-repository";
import { createMockScrapRepository } from "./mock-scrap-repository";
import { createMockLedgerRepository } from "./mock-ledger-repository";

describe("공유 mock 상태", () => {
  it("빠른 캡처를 수집함과 대시보드 대기 수에 함께 반영한다", async () => {
    const state = createMockPlatformState();
    const dashboardRepository = createMockDashboardRepository(state);
    const inboxRepository = createMockInboxRepository(state);

    await dashboardRepository.capture({ raw: "다음 주 보고서 제출" });

    expect((await inboxRepository.getSnapshot()).items[0]).toMatchObject({ raw: "다음 주 보고서 제출", status: "pending" });
    expect((await dashboardRepository.getSnapshot()).pendingCaptureCount).toBe(5);
  });

  it("빠른 캡처의 사진과 텍스트를 수집함에 함께 보존한다", async () => {
    const state = createMockPlatformState();
    const dashboardRepository = createMockDashboardRepository(state);
    const inboxRepository = createMockInboxRepository(state);
    const image = {
      name: "whiteboard.png",
      mimeType: "image/png",
      size: 12,
      mediaId: "media-image-1",
    };

    await dashboardRepository.capture({ raw: "화이트보드 회의 내용 정리", images: [image] });

    expect((await inboxRepository.getSnapshot()).items[0]).toMatchObject({
      source: "image",
      raw: "화이트보드 회의 내용 정리",
      images: [image],
    });
  });

  it("빠른 캡처 영상은 스크랩으로 승인되고 영상 종류를 보존한다", async () => {
    const state = createMockPlatformState();
    const dashboardRepository = createMockDashboardRepository(state);
    const inboxRepository = createMockInboxRepository(state);
    const scrapRepository = createMockScrapRepository(state);
    const video = {
      name: "rehearsal.mp4",
      mimeType: "video/mp4",
      size: 15,
      mediaId: "media-video-1",
    };

    await dashboardRepository.capture({ raw: "합주 녹화본", videos: [video] });
    const item = (await inboxRepository.getSnapshot()).items[0];
    await expect(inboxRepository.update(item.id, {
      target: "todo",
      fields: [{ label: "제목", value: "합주 녹화본" }],
    })).rejects.toThrow("영상은 스크랩 모듈로만 저장할 수 있습니다");
    await inboxRepository.approve(item.id);

    expect((await scrapRepository.getSnapshot()).items[0]).toMatchObject({
      kind: "video",
      title: "합주 녹화본",
    });
  });

  it("수집함 승인이 대시보드 대기 수를 줄인다", async () => {
    const state = createMockPlatformState();
    const dashboardRepository = createMockDashboardRepository(state);
    const inboxRepository = createMockInboxRepository(state);

    await inboxRepository.approve("inbox-1");

    expect((await dashboardRepository.getSnapshot()).pendingCaptureCount).toBe(3);
  });

  it("수집함의 할 일 승인을 할 일 목록과 대시보드에 함께 반영한다", async () => {
    const state = createMockPlatformState();
    const dashboardRepository = createMockDashboardRepository(state);
    const inboxRepository = createMockInboxRepository(state);
    const todoRepository = createMockTodoRepository(state);

    await inboxRepository.approve("inbox-2");

    expect((await todoRepository.getSnapshot()).items.some((item) => item.title === "기획안 검토하기")).toBe(true);
    expect((await dashboardRepository.getSnapshot()).tasks.some((task) => task.title === "기획안 검토하기")).toBe(true);
  });

  it("수집함의 일정 승인을 일정 목록과 대시보드 오늘 일정에 함께 반영한다", async () => {
    const state = createMockPlatformState();
    const inboxRepository = createMockInboxRepository(state);
    const calendarRepository = createMockCalendarRepository(state);
    const dashboardRepository = createMockDashboardRepository(state);
    await inboxRepository.update("inbox-5", {
      target: "calendar",
      fields: [
        { label: "제목", value: "오늘 치과 검진" },
        { label: "일시", value: "2026-08-05 15:00–16:00" },
        { label: "장소", value: "동네 치과" },
        { label: "분류", value: "약속" },
      ],
    });
    await inboxRepository.approve("inbox-5");

    expect((await calendarRepository.getSnapshot()).events.some((event) => event.title === "오늘 치과 검진")).toBe(true);
    expect((await dashboardRepository.getSnapshot()).events.some((event) => event.title === "오늘 치과 검진")).toBe(true);
  });

  it("수집함의 스크랩 승인을 스크랩 목록과 대시보드에 함께 반영한다", async () => {
    const state = createMockPlatformState();
    const inboxRepository = createMockInboxRepository(state);
    const scrapRepository = createMockScrapRepository(state);
    const dashboardRepository = createMockDashboardRepository(state);

    await inboxRepository.approve("inbox-4");

    expect((await scrapRepository.getSnapshot()).items[0]).toMatchObject({ title: "카메라 무빙 레퍼런스", tag: "레퍼런스", kind: "url" });
    expect((await dashboardRepository.getSnapshot()).scraps[0].title).toBe("카메라 무빙 레퍼런스");
  });

  it("수집함의 가계부 승인을 가계부와 대시보드 월 지출에 함께 반영한다", async () => {
    const state = createMockPlatformState();
    const inboxRepository = createMockInboxRepository(state);
    const ledgerRepository = createMockLedgerRepository(state);
    const dashboardRepository = createMockDashboardRepository(state);

    await inboxRepository.approve("inbox-3");

    expect((await ledgerRepository.getSnapshot()).expenses[0]).toMatchObject({ title: "점심", amountWon: 16_000, date: "2026-08-05", categoryId: "food" });
    expect((await dashboardRepository.getSnapshot()).monthlyExpense.total).toBe(625_200);
  });

  it("가계부 생성이 Dashboard의 복제 상태 없이 월 지출에 반영된다", async () => {
    const state = createMockPlatformState();
    const ledgerRepository = createMockLedgerRepository(state);
    const dashboardRepository = createMockDashboardRepository(state);

    await ledgerRepository.create({ title: "교통", amountWon: 1_500, date: "2026-08-05", categoryId: "other", note: "" });

    expect((await dashboardRepository.getSnapshot()).monthlyExpense.total).toBe(610_700);
  });
});
