import { describe, expect, it } from "vitest";
import { createMockPlatformState } from "../../infrastructure/mock/mock-platform-state";
import { summarizeLedgerMonth } from "./ledger-summary";

describe("summarizeLedgerMonth", () => {
  it("현재 월 합계와 분류별 집계를 계산한다", () => {
    const summary = summarizeLedgerMonth(createMockPlatformState().ledger);

    expect(summary.totalWon).toBe(609_200);
    expect(summary.categories.map(({ name, amountWon }) => ({ name, amountWon }))).toEqual([
      { name: "주거", amountWon: 550_000 },
      { name: "생활", amountWon: 43_200 },
      { name: "식비", amountWon: 16_000 },
    ]);
  });

  it("다른 달 거래를 현재 월 합계에서 제외한다", () => {
    const summary = summarizeLedgerMonth(createMockPlatformState().ledger);

    expect(summary.expenses.some((expense) => expense.title === "전기세")).toBe(false);
    expect(summary.expenses.some((expense) => expense.title === "합주실 대여")).toBe(false);
  });

  it("거래가 없는 전체 빈 상태를 계산한다", () => {
    const state = createMockPlatformState();
    state.ledger.expenses = [];

    expect(summarizeLedgerMonth(state.ledger)).toEqual({ expenses: [], totalWon: 0, categories: [] });
  });

  it("월 합계가 0이면 NaN이나 Infinity 비율을 만들지 않는다", () => {
    const state = createMockPlatformState();
    state.ledger.expenses = state.ledger.expenses.filter((expense) => !expense.date.startsWith("2026-08-"));
    const summary = summarizeLedgerMonth(state.ledger);

    expect(summary.totalWon).toBe(0);
    expect(summary.categories).toEqual([]);
    expect(summary.categories.every((category) => Number.isFinite(category.ratio))).toBe(true);
  });
});
