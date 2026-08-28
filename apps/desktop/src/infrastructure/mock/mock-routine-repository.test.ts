import { describe, expect, it } from "vitest";
import { createMockDashboardRepository } from "./mock-dashboard-repository";
import { createMockPlatformState } from "./mock-platform-state";
import { createMockRoutineRepository } from "./mock-routine-repository";
import { createMockTodoRepository } from "./mock-todo-repository";

describe("MockRoutineRepository", () => {
  it("생성과 수정을 공유 routine state에 반영한다", async () => {
    const repository = createMockRoutineRepository();
    await repository.create({ title: "물 마시기", labelId: "health", days: [3, 1], endDate: null });
    let snapshot = await repository.getSnapshot();
    const created = snapshot.items.find((routine) => routine.title === "물 마시기")!;
    expect(created).toMatchObject({ days: [1, 3], startDate: "2026-08-05", endDate: null });

    await repository.update(created.id, { title: "물 2L 마시기", labelId: "health", days: [3], endDate: "2026-08-31" });
    snapshot = await repository.getSnapshot();
    expect(snapshot.items.find((routine) => routine.id === created.id)).toMatchObject({ title: "물 2L 마시기", days: [3], endDate: "2026-08-31" });
  });

  it("오늘 occurrence를 결정 키로 한 번만 만든다", async () => {
    const state = createMockPlatformState();
    const repository = createMockRoutineRepository(state);
    await repository.getSnapshot();
    const firstCount = state.routine.occurrences.length;
    await repository.getSnapshot();
    await createMockTodoRepository(state).getSnapshot();
    await createMockDashboardRepository(state).getSnapshot();

    expect(state.routine.occurrences).toHaveLength(firstCount);
    const keys = state.routine.occurrences.map((occurrence) => `${occurrence.routineId}:${occurrence.occurrenceDate}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("비지정 요일과 종료일 이후에는 occurrence를 만들지 않는다", async () => {
    const state = createMockPlatformState();
    state.routine.items = [
      { id: "off-day", title: "목요일 루틴", labelId: "health", days: [4], startDate: "2026-08-01", endDate: null },
      { id: "expired", title: "끝난 루틴", labelId: "health", days: [3], startDate: "2026-07-01", endDate: "2026-08-04" },
    ];
    state.routine.occurrences = [];

    const snapshot = await createMockRoutineRepository(state).getSnapshot();
    expect(snapshot.occurrences).toHaveLength(0);
    expect((await createMockTodoRepository(state).getSnapshot()).items.every((item) => item.routineId === null)).toBe(true);
  });

  it("오늘 완료를 루틴·할 일·대시보드에 함께 반영한다", async () => {
    const state = createMockPlatformState();
    const routineRepository = createMockRoutineRepository(state);
    const todoRepository = createMockTodoRepository(state);
    const dashboardRepository = createMockDashboardRepository(state);

    await routineRepository.toggleToday("routine-1");
    expect((await routineRepository.getSnapshot()).occurrences.find((item) => item.routineId === "routine-1" && item.occurrenceDate === state.todo.today)?.done).toBe(true);
    expect((await todoRepository.getSnapshot()).items.find((item) => item.routineId === "routine-1")?.done).toBe(true);
    expect((await dashboardRepository.getSnapshot()).tasks.find((item) => item.id.includes("routine-1"))?.done).toBe(true);
  });
});
