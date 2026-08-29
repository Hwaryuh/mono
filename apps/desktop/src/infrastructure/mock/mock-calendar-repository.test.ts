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
