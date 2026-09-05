import { describe, expect, it } from "vitest";
import { createMockPlatformState } from "../../infrastructure/mock/mock-platform-state";
import { summarizeLedgerMonth } from "./ledger-summary";

describe("summarizeLedgerMonth", () => {
  it("calculates the current month's total and per-category aggregates", () => {
    const summary = summarizeLedgerMonth(createMockPlatformState().ledger);

    expect(summary.totalWon).toBe(609_200);
    expect(summary.categories.map(({ name, amountWon }) => ({ name, amountWon }))).toEqual([
      { name: "주거", amountWon: 550_000 },
      { name: "생활", amountWon: 43_200 },
      { name: "식비", amountWon: 16_000 },
    ]);
  });

  it("excludes transactions from other months from the current month's total", () => {
    const summary = summarizeLedgerMonth(createMockPlatformState().ledger);

    expect(summary.expenses.some((expense) => expense.title === "전기세")).toBe(false);
    expect(summary.expenses.some((expense) => expense.title === "합주실 대여")).toBe(false);
  });

  it("calculates the full empty state when there are no transactions", () => {
    const state = createMockPlatformState();
    state.ledger.expenses = [];

    expect(summarizeLedgerMonth(state.ledger)).toEqual({ expenses: [], totalWon: 0, categories: [] });
  });

  it("does not produce NaN or Infinity ratios when the monthly total is 0", () => {
    const state = createMockPlatformState();
    state.ledger.expenses = state.ledger.expenses.filter((expense) => !expense.date.startsWith("2026-08-"));
    const summary = summarizeLedgerMonth(state.ledger);

    expect(summary.totalWon).toBe(0);
    expect(summary.categories).toEqual([]);
    expect(summary.categories.every((category) => Number.isFinite(category.ratio))).toBe(true);
  });
});
