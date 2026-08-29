import { describe, expect, it } from "vitest";
import { createMockCalendarRepository } from "./mock-calendar-repository";

describe("MockCalendarRepository", () => {
  it("일정 snapshot을 반환하고 생성·수정한다", async () => {
    const repository = createMockCalendarRepository();
    const before = await repository.getSnapshot();

    await repository.create({
      title: "치과 검진",
      startDate: "2026-08-18",
      startTime: "15:00",
      endDate: "2026-08-18",
      endTime: "16:00",
      location: "동네 치과",
      categoryId: "appointment",
      note: "보험 서류 챙기기",
    });

    const created = (await repository.getSnapshot()).events.find((event) => event.title === "치과 검진")!;
    expect(created).toMatchObject({ location: "동네 치과", startTime: "15:00" });
    await repository.update(created.id, { ...created, title: "정기 치과 검진", note: "" });
    expect((await repository.getSnapshot()).events.find((event) => event.id === created.id)?.title).toBe("정기 치과 검진");
    expect(before.events).toHaveLength(9);
  });

  const weeklyMonday = { freq: "weekly" as const, interval: 1, weekdays: [1], until: null, count: null };

  it("반복 일정을 창 안에서 회차로 펼치고 3-way로 편집한다", async () => {
    const repository = createMockCalendarRepository();
    await repository.create({
      title: "주간 회의", startDate: "2026-09-07", startTime: "10:00", endDate: "2026-09-07", endTime: "11:00",
      location: "회의실", categoryId: "work", note: "", recurrence: weeklyMonday,
    });
    const range = { from: "2026-09-01", to: "2026-09-30" };
    const occurrences = (await repository.getSnapshot(range)).events.filter((event) => event.title === "주간 회의");
    expect(occurrences.map((event) => event.startDate)).toEqual(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
    expect(occurrences.every((event) => event.seriesId != null)).toBe(true);

    const master = occurrences[0].seriesId!;

    // 이 일정만: 9/14 회차만 시간 변경
    await repository.update(`${master}::2026-09-14`, {
      ...occurrences[1], title: "주간 회의(연기)", startTime: "15:00",
    }, "this");
    let events = (await repository.getSnapshot(range)).events.filter((event) => event.title.startsWith("주간 회의"));
    expect(events.find((event) => event.startDate === "2026-09-14")).toMatchObject({ title: "주간 회의(연기)", startTime: "15:00" });
    expect(events.find((event) => event.startDate === "2026-09-21")?.title).toBe("주간 회의");

    // 이 일정만 삭제: 9/21 취소
    await repository.remove(`${master}::2026-09-21`, "this");
    events = (await repository.getSnapshot(range)).events.filter((event) => event.title.startsWith("주간 회의"));
    expect(events.some((event) => event.startDate === "2026-09-21")).toBe(false);

    // 이후 모두: 9/28부터 제목 변경 → 시리즈 분할
    await repository.update(`${master}::2026-09-28`, {
      ...occurrences[3], title: "새 주간 회의", recurrence: weeklyMonday,
    }, "future");
    events = (await repository.getSnapshot(range)).events;
    expect(events.find((event) => event.startDate === "2026-09-28")?.title).toBe("새 주간 회의");
    expect(new Set(events.filter((event) => event.title.includes("주간 회의")).map((event) => event.seriesId)).size).toBe(2);
  });

  it("반복 일정 전체 삭제 시 회차와 예외가 모두 사라진다", async () => {
    const repository = createMockCalendarRepository();
    await repository.create({
      title: "스탠드업", startDate: "2026-09-07", startTime: null, endDate: "2026-09-07", endTime: null,
      location: "", categoryId: "work", note: "", recurrence: weeklyMonday,
    });
    const range = { from: "2026-09-01", to: "2026-09-30" };
    const master = (await repository.getSnapshot(range)).events.find((event) => event.title === "스탠드업")!.seriesId!;
    await repository.remove(`${master}::2026-09-14`, "this");
    await repository.remove(master, "all");
    const events = (await repository.getSnapshot(range)).events.filter((event) => event.title === "스탠드업");
    expect(events).toHaveLength(0);
  });

  it("없는 일정 수정은 실패한다", async () => {
    const repository = createMockCalendarRepository();
    await expect(repository.update("missing", {
      title: "없는 일정",
      startDate: "2026-08-05",
      startTime: null,
      endDate: "2026-08-05",
      endTime: null,
      location: "",
      categoryId: "work",
      note: "",
    })).rejects.toThrow("일정을 찾을 수 없습니다");
  });

  it("일정 분류를 생성·수정·정렬한다", async () => {
    const repository = createMockCalendarRepository();

    await repository.createCategory({ name: "프로젝트", color: "#123ABC" });
    let snapshot = await repository.getSnapshot();
    const category = snapshot.categories.find((candidate) => candidate.name === "프로젝트")!;
    expect(category.color).toBe("oklch(0.423 0.207 264.715)");

    await repository.updateCategory(category.id, { name: "사이드 프로젝트", color: "#654321" });
    await repository.reorderCategories([category.id, ...snapshot.categories.filter((candidate) => candidate.id !== category.id).map((candidate) => candidate.id)]);
    snapshot = await repository.getSnapshot();
    expect(snapshot.categories[0]).toMatchObject({ id: category.id, name: "사이드 프로젝트", color: "oklch(0.414 0.068 63.983)" });
  });

  it("사용 중인 일정 분류 삭제 시 기존 일정을 대체 분류로 이동한다", async () => {
    const repository = createMockCalendarRepository();

    await repository.deleteCategory("appointment", "personal");
    const snapshot = await repository.getSnapshot();

    expect(snapshot.categories.some((category) => category.id === "appointment")).toBe(false);
    expect(snapshot.events.filter((event) => ["event-2", "event-5"].includes(event.id)).every((event) => event.categoryId === "personal")).toBe(true);
  });
});
