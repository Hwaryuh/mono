import { describe, expect, it } from "vitest";
import { createMockTodoRepository } from "./mock-todo-repository";

describe("MockTodoRepository", () => {
  it("계약을 만족하는 할 일 스냅샷을 반환한다", async () => {
    const repository = createMockTodoRepository();
    const snapshot = await repository.getSnapshot();

    expect(snapshot.items.filter((item) => item.routineId === null)).toHaveLength(5);
    expect(snapshot.items.filter((item) => item.routineId !== null)).toHaveLength(2);
    expect(snapshot.labels.map((label) => label.name)).toEqual(["집안일", "업무", "건강", "재무", "기타"]);
  });

  it("생성, 수정, 완료, 삭제를 같은 상태에 반영한다", async () => {
    const repository = createMockTodoRepository();
    await repository.create({ title: "새 테스트", labelId: "work", dueDate: "2026-08-06", dueTime: "09:00", note: "메모" });
    let snapshot = await repository.getSnapshot();
    const created = snapshot.items.find((item) => item.title === "새 테스트")!;
    expect(created).toMatchObject({ title: "새 테스트", done: false });

    await repository.update(created.id, { title: "수정 테스트", labelId: "home", dueDate: null, dueTime: null, note: "" });
    await repository.toggleComplete(created.id);
    snapshot = await repository.getSnapshot();
    expect(snapshot.items.find((item) => item.id === created.id)).toMatchObject({ title: "수정 테스트", labelId: "home", done: true, completedAt: "방금" });

    await repository.delete(created.id);
    expect((await repository.getSnapshot()).items.some((item) => item.id === created.id)).toBe(false);
  });

  it("라벨을 원본 상태에 추가하고 중복 이름을 거부한다", async () => {
    const repository = createMockTodoRepository();
    await repository.createLabel({ name: "  개인 프로젝트  ", color: "#AABBCC" });

    expect((await repository.getSnapshot()).labels.find((label) => label.id === "label-1")).toMatchObject({
      id: "label-1",
      name: "개인 프로젝트",
      color: "oklch(0.784 0.031 248.218)",
    });
    await expect(repository.createLabel({ name: "개인 프로젝트", color: "#3f7d5e" })).rejects.toThrow("같은 이름의 라벨이 이미 있습니다.");
  });

  it("라벨을 수정하고 순서를 변경한다", async () => {
    const repository = createMockTodoRepository();
    await repository.updateLabel("home", { name: "집", color: "#123456" });
    await repository.reorderLabels(["work", "home", "health", "money", "other"]);

    const snapshot = await repository.getSnapshot();
    expect(snapshot.labels.map((label) => label.id)).toEqual(["work", "home", "health", "money", "other"]);
    expect(snapshot.labels.find((label) => label.id === "home")).toMatchObject({ name: "집", color: "oklch(0.319 0.072 251.168)" });
  });

  it("라벨 삭제 시 일반 할 일과 반복 할 일을 선택한 라벨로 이동한다", async () => {
    const repository = createMockTodoRepository();
    await repository.deleteLabel("health", "home");

    const snapshot = await repository.getSnapshot();
    expect(snapshot.labels.some((label) => label.id === "health")).toBe(false);
    expect(snapshot.items.filter((item) => item.title === "비타민 먹기" || item.title === "운동 30분 하기").every((item) => item.labelId === "home")).toBe(true);
    await expect(repository.deleteLabel("home", "home")).rejects.toThrow("달라야 합니다");
  });
});
