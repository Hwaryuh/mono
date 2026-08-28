import type { RoutineDefinition, RoutineOccurrence, TodoItem } from "@mono/contracts";
import type { MockPlatformState } from "./mock-platform-state";

export function occurrenceId(routineId: string, occurrenceDate: string) {
  return `routine-occurrence:${routineId}:${occurrenceDate}`;
}

export function isRoutineScheduled(routine: RoutineDefinition, date: string) {
  if (date < routine.startDate || (routine.endDate && date > routine.endDate)) return false;
  return routine.days.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
}

export function ensureRoutineOccurrence(state: MockPlatformState, routine: RoutineDefinition, date: string) {
  if (!isRoutineScheduled(routine, date)) return null;
  const existing = state.routine.occurrences.find(
    (candidate) => candidate.routineId === routine.id && candidate.occurrenceDate === date,
  );
  if (existing) return existing;
  const occurrence: RoutineOccurrence = {
    id: occurrenceId(routine.id, date),
    routineId: routine.id,
    occurrenceDate: date,
    done: false,
    completedAt: null,
  };
  state.routine.occurrences.push(occurrence);
  return occurrence;
}

export function todayRoutineOccurrences(state: MockPlatformState) {
  return state.routine.items.flatMap((routine) => {
    const occurrence = ensureRoutineOccurrence(state, routine, state.todo.today);
    return occurrence ? [{ routine, occurrence }] : [];
  });
}

export function toggleOccurrence(state: MockPlatformState, occurrence: RoutineOccurrence) {
  state.routine.occurrences = state.routine.occurrences.map((candidate) => candidate.id === occurrence.id
    ? { ...candidate, done: !candidate.done, completedAt: candidate.done ? null : "방금" }
    : candidate);
}

export function toggleRoutineToday(state: MockPlatformState, routineId: string) {
  const routine = state.routine.items.find((candidate) => candidate.id === routineId);
  if (!routine) throw new Error(`루틴을 찾을 수 없습니다: ${routineId}`);
  const occurrence = ensureRoutineOccurrence(state, routine, state.todo.today);
  if (!occurrence) throw new Error("오늘 실행하는 루틴이 아닙니다.");
  toggleOccurrence(state, occurrence);
}

export function toggleRoutineOccurrence(state: MockPlatformState, itemId: string) {
  const occurrence = state.routine.occurrences.find((candidate) => candidate.id === itemId);
  if (!occurrence) return false;
  toggleOccurrence(state, occurrence);
  return true;
}

export function routineTodoItems(state: MockPlatformState): TodoItem[] {
  return todayRoutineOccurrences(state).map(({ routine, occurrence }) => ({
    id: occurrence.id,
    title: routine.title,
    labelId: routine.labelId,
    dueDate: occurrence.occurrenceDate,
    dueTime: null,
    note: "",
    done: occurrence.done,
    completedAt: occurrence.completedAt,
    routineId: routine.id,
    occurrenceDate: occurrence.occurrenceDate,
  }));
}
