import type { DayEntryWriteInput, DaySnapshot } from "@mono/contracts";

export interface DayRepository {
  getSnapshot(date: string): Promise<DaySnapshot>;
  create(input: DayEntryWriteInput): Promise<void>;
  update(entryId: string, input: DayEntryWriteInput, expectedVersion?: number): Promise<void>;
  remove(entryId: string): Promise<void>;
}
