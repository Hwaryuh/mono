import type { RoutineSnapshot, RoutineWriteInput } from "@mono/contracts";

export interface RoutineRepository {
  getSnapshot(): Promise<RoutineSnapshot>;
  create(input: RoutineWriteInput): Promise<void>;
  update(routineId: string, input: RoutineWriteInput): Promise<void>;
  toggleToday(routineId: string): Promise<void>;
}
