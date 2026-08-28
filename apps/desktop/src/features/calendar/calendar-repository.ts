import type { CalendarCategoryWriteInput, CalendarSnapshot, CalendarWriteInput } from "@mono/contracts";

export interface CalendarCategoryRepository {
  createCategory(input: CalendarCategoryWriteInput): Promise<void>;
  updateCategory(categoryId: string, input: CalendarCategoryWriteInput): Promise<void>;
  reorderCategories(categoryIds: string[]): Promise<void>;
  deleteCategory(categoryId: string, replacementCategoryId: string): Promise<void>;
}

export interface CalendarRepository extends CalendarCategoryRepository {
  getSnapshot(): Promise<CalendarSnapshot>;
  create(input: CalendarWriteInput): Promise<void>;
  update(eventId: string, input: CalendarWriteInput): Promise<void>;
}
