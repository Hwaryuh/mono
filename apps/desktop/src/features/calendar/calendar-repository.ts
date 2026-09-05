import type { CalendarCategoryWriteInput, CalendarEditScope, CalendarSnapshot, CalendarWriteInput } from "@mono/contracts";

export interface CalendarCategoryRepository {
  createCategory(input: CalendarCategoryWriteInput): Promise<void>;
  updateCategory(categoryId: string, input: CalendarCategoryWriteInput, expectedVersion?: number): Promise<void>;
  reorderCategories(categoryIds: string[]): Promise<void>;
  deleteCategory(categoryId: string, replacementCategoryId: string): Promise<void>;
}

export type CalendarRange = { from: string; to: string };

export interface CalendarRepository extends CalendarCategoryRepository {
  getSnapshot(range?: CalendarRange): Promise<CalendarSnapshot>;
  create(input: CalendarWriteInput): Promise<void>;
  // eventId is either a single event's uuid or a recurring occurrence's "uuid::YYYY-MM-DD". scope only applies to recurring events.
  update(eventId: string, input: CalendarWriteInput, scope?: CalendarEditScope, expectedVersion?: number): Promise<void>;
  remove(eventId: string, scope?: CalendarEditScope): Promise<void>;
}
