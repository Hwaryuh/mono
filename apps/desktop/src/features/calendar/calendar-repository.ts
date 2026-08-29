import type { CalendarCategoryWriteInput, CalendarEditScope, CalendarSnapshot, CalendarWriteInput } from "@mono/contracts";

export interface CalendarCategoryRepository {
  createCategory(input: CalendarCategoryWriteInput): Promise<void>;
  updateCategory(categoryId: string, input: CalendarCategoryWriteInput): Promise<void>;
  reorderCategories(categoryIds: string[]): Promise<void>;
  deleteCategory(categoryId: string, replacementCategoryId: string): Promise<void>;
}

export type CalendarRange = { from: string; to: string };

export interface CalendarRepository extends CalendarCategoryRepository {
  getSnapshot(range?: CalendarRange): Promise<CalendarSnapshot>;
  create(input: CalendarWriteInput): Promise<void>;
  // eventId 는 단발 일정의 uuid 또는 반복 occurrence의 "uuid::YYYY-MM-DD". scope 는 반복 일정에만 적용.
  update(eventId: string, input: CalendarWriteInput, scope?: CalendarEditScope): Promise<void>;
  remove(eventId: string, scope?: CalendarEditScope): Promise<void>;
}
