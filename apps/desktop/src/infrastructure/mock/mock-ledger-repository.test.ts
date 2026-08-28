import { ledgerWriteInputSchema, wonAmountSchema } from "@mono/contracts";
import { describe, expect, it } from "vitest";
import { createMockLedgerRepository } from "./mock-ledger-repository";

describe("MockLedgerRepository", () => {
  it("가계부 원본 snapshot을 반환한다", async () => {
    const snapshot = await createMockLedgerRepository().getSnapshot();

    expect(snapshot.expenses).toHaveLength(5);
    expect(snapshot.expenses[0].date).toBe("2026-08-05");
    expect(snapshot.comparison).toEqual({ direction: "less", percentage: 8 });
  });

  it("쉼표와 원화 기호가 포함된 금액을 원 단위 정수로 정규화한다", async () => {
    const repository = createMockLedgerRepository();
    const input = ledgerWriteInputSchema.parse({ title: "저녁", amountWon: "₩ 12,345원", date: "2026-08-05", categoryId: "food", note: "" });

    await repository.create(input);

    expect((await repository.getSnapshot()).expenses[0].amountWon).toBe(12_345);
  });

  it("잘못된 금액과 실제로 존재하지 않는 ISO 날짜를 거부한다", () => {
    expect(wonAmountSchema.safeParse("12.5").success).toBe(false);
    expect(wonAmountSchema.safeParse("0").success).toBe(false);
    expect(wonAmountSchema.safeParse("9,007,199,254,740,992").success).toBe(false);
    expect(ledgerWriteInputSchema.safeParse({ title: "지출", amountWon: "1,000", date: "2026-02-30", categoryId: "food", note: "" }).success).toBe(false);
  });

  it("분류를 추가·수정하고 순서를 변경한다", async () => {
    const repository = createMockLedgerRepository();
    await repository.createCategory({ name: "교통", color: "#123456" });
    let snapshot = await repository.getSnapshot();
    const category = snapshot.categories.find((candidate) => candidate.name === "교통")!;

    await repository.updateCategory(category.id, { name: "대중교통", color: "#654321" });
    snapshot = await repository.getSnapshot();
    await repository.reorderCategories([category.id, ...snapshot.categories.filter((candidate) => candidate.id !== category.id).map((candidate) => candidate.id)]);

    expect((await repository.getSnapshot()).categories[0]).toMatchObject({ id: category.id, name: "대중교통", color: "oklch(0.414 0.068 63.983)" });
  });

  it("사용 중인 분류를 삭제하면 지출을 기타로 이동하고 기타 삭제는 거부한다", async () => {
    const repository = createMockLedgerRepository();
    await repository.deleteCategory("food");
    const snapshot = await repository.getSnapshot();

    expect(snapshot.categories.some((category) => category.id === "food")).toBe(false);
    expect(snapshot.expenses.find((expense) => expense.id === "expense-1")?.categoryId).toBe("other");
    await expect(repository.deleteCategory("other")).rejects.toThrow("기타 분류는 삭제할 수 없습니다");
  });
});
