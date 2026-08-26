import { routineSnapshotSchema, routineWriteInputSchema } from "@mono/contracts";
import type { RoutineRepository } from "../../features/routine/routine-repository";
import { createMockPlatformState, type MockPlatformState } from "./mock-platform-state";
import { todayRoutineOccurrences, toggleRoutineToday } from "./mock-routine-occurrences";

function requireRoutine(state: MockPlatformState, routineId: string) {
  const routine = state.routine.items.find((candidate) => candidate.id === routineId);
  if (!routine) throw new Error(`루틴을 찾을 수 없습니다: ${routineId}`);
  return routine;
}

class MockRoutineRepository implements RoutineRepository {
  constructor(private readonly state: MockPlatformState) {}

  async getSnapshot() {
    todayRoutineOccurrences(this.state);
    return routineSnapshotSchema.parse(structuredClone({
      today: this.state.todo.today,
      labels: this.state.todo.labels,
      items: this.state.routine.items,
      occurrences: this.state.routine.occurrences,
    }));
  }

  async create(input: Parameters<RoutineRepository["create"]>[0]) {
    const parsed = routineWriteInputSchema.parse(input);
    this.state.routine.items = [{
      id: `routine-${this.state.nextRoutineId++}`,
      ...parsed,
      days: [...parsed.days].sort((left, right) => left - right),
      startDate: this.state.todo.today,
    }, ...this.state.routine.items];
  }

  async update(routineId: string, input: Parameters<RoutineRepository["update"]>[1]) {
    requireRoutine(this.state, routineId);
    const parsed = routineWriteInputSchema.parse(input);
    this.state.routine.items = this.state.routine.items.map((routine) => routine.id === routineId
      ? { ...routine, ...parsed, days: [...parsed.days].sort((left, right) => left - right) }
      : routine);
  }

  async toggleToday(routineId: string) {
    toggleRoutineToday(this.state, routineId);
  }
}

export function createMockRoutineRepository(state = createMockPlatformState()): RoutineRepository {
  return new MockRoutineRepository(state);
}
