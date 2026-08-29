import { ledgerCategoryOrderSchema, ledgerCategoryWriteInputSchema, ledgerSnapshotSchema, ledgerWriteInputSchema, type LedgerCategoryWriteInput, type LedgerWriteInput } from "@mono/contracts";
import type { LedgerRepository } from "../../features/ledger/ledger-repository";
import { createMockPlatformState, type MockPlatformState } from "./mock-platform-state";

class MockLedgerRepository implements LedgerRepository {
  constructor(private readonly state: MockPlatformState) {}

  async getSnapshot() {
    return ledgerSnapshotSchema.parse(structuredClone(this.state.ledger));
  }

  async create(input: LedgerWriteInput) {
    const parsed = ledgerWriteInputSchema.parse(input);
    this.state.ledger.expenses = [{ id: `expense-${this.state.nextLedgerId++}`, ...parsed }, ...this.state.ledger.expenses];
  }

  async update(expenseId: string, input: LedgerWriteInput) {
    this.requireExpense(expenseId);
    const parsed = ledgerWriteInputSchema.parse(input);
    this.state.ledger.expenses = this.state.ledger.expenses.map((expense) => expense.id === expenseId ? { ...expense, ...parsed } : expense);
  }

  async remove(expenseId: string) {
    this.requireExpense(expenseId);
    this.state.ledger.expenses = this.state.ledger.expenses.filter((expense) => expense.id !== expenseId);
  }

  async createCategory(input: LedgerCategoryWriteInput) {
    const parsed = ledgerCategoryWriteInputSchema.parse(input);
    this.assertUniqueName(parsed.name);
    const category = { id: `ledger-category-${this.state.nextLedgerCategoryId++}`, ...parsed };
    const fallbackIndex = this.state.ledger.categories.findIndex((candidate) => candidate.id === "other");
    if (fallbackIndex < 0) this.state.ledger.categories.push(category);
    else this.state.ledger.categories.splice(fallbackIndex, 0, category);
  }

  async updateCategory(categoryId: string, input: LedgerCategoryWriteInput) {
    this.requireCategory(categoryId);
    const parsed = ledgerCategoryWriteInputSchema.parse(input);
    this.assertUniqueName(parsed.name, categoryId);
    this.state.ledger.categories = this.state.ledger.categories.map((category) => category.id === categoryId ? { ...category, ...parsed } : category);
  }

  async reorderCategories(categoryIds: string[]) {
    const parsed = ledgerCategoryOrderSchema.parse(categoryIds);
    const currentIds = new Set(this.state.ledger.categories.map((category) => category.id));
    if (parsed.length !== currentIds.size || new Set(parsed).size !== parsed.length || parsed.some((categoryId) => !currentIds.has(categoryId))) {
      throw new Error("분류 순서에 현재 분류가 모두 포함되어야 합니다.");
    }
    const categories = new Map(this.state.ledger.categories.map((category) => [category.id, category]));
    this.state.ledger.categories = parsed.map((categoryId) => categories.get(categoryId)!);
  }

  async deleteCategory(categoryId: string) {
    this.requireCategory(categoryId);
    if (categoryId === "other") throw new Error("기타 분류는 삭제할 수 없습니다.");
    const fallback = this.state.ledger.categories.find((category) => category.id === "other");
    if (!fallback) throw new Error("기타 분류를 찾을 수 없습니다.");
    this.state.ledger.expenses = this.state.ledger.expenses.map((expense) => expense.categoryId === categoryId ? { ...expense, categoryId: fallback.id } : expense);
    this.state.ledger.categories = this.state.ledger.categories.filter((category) => category.id !== categoryId);
  }

  private requireExpense(expenseId: string) {
    if (!this.state.ledger.expenses.some((expense) => expense.id === expenseId)) {
      throw new Error(`지출을 찾을 수 없습니다: ${expenseId}`);
    }
  }

  private requireCategory(categoryId: string) {
    const category = this.state.ledger.categories.find((candidate) => candidate.id === categoryId);
    if (!category) throw new Error(`가계부 라벨을 찾을 수 없습니다: ${categoryId}`);
    return category;
  }

  private assertUniqueName(name: string, exceptCategoryId?: string) {
    const normalized = name.toLocaleLowerCase("ko-KR");
    if (this.state.ledger.categories.some((category) => category.id !== exceptCategoryId && category.name.toLocaleLowerCase("ko-KR") === normalized)) {
      throw new Error("같은 이름의 분류가 이미 있습니다.");
    }
  }
}

export function createMockLedgerRepository(state = createMockPlatformState()): LedgerRepository {
  return new MockLedgerRepository(state);
}
