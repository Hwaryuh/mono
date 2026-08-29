import type { LedgerCategoryWriteInput, LedgerSnapshot, LedgerWriteInput } from "@mono/contracts";

export interface LedgerCategoryRepository {
  createCategory(input: LedgerCategoryWriteInput): Promise<void>;
  updateCategory(categoryId: string, input: LedgerCategoryWriteInput): Promise<void>;
  reorderCategories(categoryIds: string[]): Promise<void>;
  deleteCategory(categoryId: string): Promise<void>;
}

export interface LedgerRepository extends LedgerCategoryRepository {
  getSnapshot(): Promise<LedgerSnapshot>;
  create(input: LedgerWriteInput): Promise<void>;
  update(expenseId: string, input: LedgerWriteInput): Promise<void>;
  remove(expenseId: string): Promise<void>;
}
