import type { RoutineSnapshot, RoutineWriteInput } from "@mono/contracts";

export interface RoutineRepository {
  getSnapshot(): Promise<RoutineSnapshot>;
  create(input: RoutineWriteInput): Promise<void>;
  update(routineId: string, input: RoutineWriteInput, expectedVersion?: number): Promise<void>;
  delete(routineId: string): Promise<void>;
  toggleToday(routineId: string): Promise<void>;
}
