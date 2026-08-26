import { randomUUID } from "node:crypto";
import {
  ledgerCategoryOrderSchema,
  ledgerCategoryWriteInputSchema,
  ledgerSnapshotSchema,
  ledgerWriteInputSchema,
  type LedgerCategoryWriteInput,
  type LedgerSnapshot,
  type LedgerWriteInput,
} from "@mono/contracts";
import { currentIsoDate } from "@mono/domain";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { LEDGER_OTHER_CATEGORY_ID, ledgerCategories, ledgerExpenses } from "../db/schema.ts";

function previousMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(year, m - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

// 서버 Ledger 저장소. 데스크톱 LedgerRepository 인터페이스와 같은 op·에러 시맨틱을 만족한다.
// mock은 comparison을 고정값으로 심었다(§handoff). 여기서는 실제 전월 동기 합계 대비로 계산한다.
export class SqliteLedgerRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async getSnapshot(): Promise<LedgerSnapshot> {
    const today = currentIsoDate();
    const month = today.slice(0, 7);
    const categories = this.db.select().from(ledgerCategories).orderBy(asc(ledgerCategories.orderIndex)).all();
    const expenses = this.db.select().from(ledgerExpenses).orderBy(desc(ledgerExpenses.seq)).all();

    const currentTotal = expenses.filter((expense) => expense.date.startsWith(`${month}-`)).reduce((sum, expense) => sum + expense.amountWon, 0);
    const prevMonth = previousMonth(month);
    const prevTotal = expenses.filter((expense) => expense.date.startsWith(`${prevMonth}-`)).reduce((sum, expense) => sum + expense.amountWon, 0);

    return ledgerSnapshotSchema.parse({
      today,
      categories: categories.map(({ orderIndex: _orderIndex, ...category }) => category),
      expenses: expenses.map(({ seq: _seq, ...expense }) => expense),
      comparison: this.compareToPrevious(currentTotal, prevTotal),
    });
  }

  async create(input: LedgerWriteInput): Promise<void> {
    const parsed = ledgerWriteInputSchema.parse(input);
    const nextSeq = (this.db.select({ max: sql<number>`COALESCE(MAX(${ledgerExpenses.seq}), 0)` }).from(ledgerExpenses).get()?.max ?? 0) + 1;
    this.db.insert(ledgerExpenses).values({ id: randomUUID(), seq: nextSeq, ...parsed }).run();
  }

  async createCategory(input: LedgerCategoryWriteInput): Promise<void> {
    const parsed = ledgerCategoryWriteInputSchema.parse(input);
    this.assertUniqueName(parsed.name);
    // "기타"는 항상 마지막에 남도록 order_index를 그보다 작게 매긴다.
    const nextOrder = (this.db.select({ max: sql<number>`COALESCE(MAX(${ledgerCategories.orderIndex}), -1)` })
      .from(ledgerCategories).where(sql`${ledgerCategories.id} != ${LEDGER_OTHER_CATEGORY_ID}`).get()?.max ?? -1) + 1;
    this.db.insert(ledgerCategories).values({ id: randomUUID(), name: parsed.name, color: parsed.color, orderIndex: nextOrder }).run();
  }

  async updateCategory(categoryId: string, input: LedgerCategoryWriteInput): Promise<void> {
    this.requireCategory(categoryId);
    const parsed = ledgerCategoryWriteInputSchema.parse(input);
    this.assertUniqueName(parsed.name, categoryId);
    this.db.update(ledgerCategories).set({ name: parsed.name, color: parsed.color }).where(eq(ledgerCategories.id, categoryId)).run();
  }

  async reorderCategories(categoryIds: string[]): Promise<void> {
    const parsed = ledgerCategoryOrderSchema.parse(categoryIds);
    const currentIds = this.db.select({ id: ledgerCategories.id }).from(ledgerCategories).all().map((row) => row.id);
    if (parsed.length !== currentIds.length || new Set(parsed).size !== currentIds.length || currentIds.some((id) => !parsed.includes(id))) {
      throw new Error("분류 순서에 현재 분류가 모두 포함되어야 합니다.");
    }
    this.db.transaction((tx) => {
      parsed.forEach((id, index) => tx.update(ledgerCategories).set({ orderIndex: index }).where(eq(ledgerCategories.id, id)).run());
    });
  }

  async deleteCategory(categoryId: string): Promise<void> {
    this.requireCategory(categoryId);
    if (categoryId === LEDGER_OTHER_CATEGORY_ID) throw new Error("기타 분류는 삭제할 수 없습니다.");
    const fallback = this.db.select().from(ledgerCategories).where(eq(ledgerCategories.id, LEDGER_OTHER_CATEGORY_ID)).get();
    if (!fallback) throw new Error("기타 분류를 찾을 수 없습니다.");
    this.db.transaction((tx) => {
      tx.update(ledgerExpenses).set({ categoryId: fallback.id }).where(eq(ledgerExpenses.categoryId, categoryId)).run();
      tx.delete(ledgerCategories).where(eq(ledgerCategories.id, categoryId)).run();
    });
  }

  private compareToPrevious(currentTotal: number, prevTotal: number): LedgerSnapshot["comparison"] {
    if (prevTotal === 0) return { direction: currentTotal === 0 ? "same" : "more", percentage: currentTotal === 0 ? 0 : 100 };
    const percentage = Math.round((Math.abs(currentTotal - prevTotal) / prevTotal) * 100);
    if (currentTotal === prevTotal) return { direction: "same", percentage: 0 };
    return { direction: currentTotal < prevTotal ? "less" : "more", percentage };
  }

  private requireCategory(categoryId: string) {
    const category = this.db.select().from(ledgerCategories).where(eq(ledgerCategories.id, categoryId)).get();
    if (!category) throw new Error(`가계부 라벨을 찾을 수 없습니다: ${categoryId}`);
    return category;
  }

  private assertUniqueName(name: string, exceptCategoryId?: string) {
    const clash = this.db.select().from(ledgerCategories).all().some((category) =>
      category.id !== exceptCategoryId && category.name.toLocaleLowerCase("ko-KR") === name.toLocaleLowerCase("ko-KR"));
    if (clash) throw new Error("같은 이름의 분류가 이미 있습니다.");
  }
}
