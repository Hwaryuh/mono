import type { LedgerCategory, LedgerExpense, LedgerSnapshot } from "@mono/contracts";

export type LedgerCategorySummary = LedgerCategory & {
  amountWon: number;
  ratio: number;
};

export type LedgerMonthSummary = {
  expenses: LedgerExpense[];
  totalWon: number;
  categories: LedgerCategorySummary[];
};

export function summarizeLedgerMonth(snapshot: LedgerSnapshot, month = snapshot.today.slice(0, 7)): LedgerMonthSummary {
  const expenses = snapshot.expenses
    .filter((expense) => expense.date.startsWith(`${month}-`))
    .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
  const totalWon = expenses.reduce((sum, expense) => sum + expense.amountWon, 0);
  const categories = snapshot.categories
    .map((category) => {
      const amountWon = expenses
        .filter((expense) => expense.categoryId === category.id)
        .reduce((sum, expense) => sum + expense.amountWon, 0);
      return { ...category, amountWon, ratio: totalWon === 0 ? 0 : amountWon / totalWon };
    })
    .filter((category) => category.amountWon > 0)
    .sort((left, right) => right.amountWon - left.amountWon);

  return { expenses, totalWon, categories };
}
