import type { LedgerSnapshot } from "@mono/contracts";
import type { LedgerRepository } from "../../features/ledger/ledger-repository";
import { httpDelete, httpGet, httpPost, httpPut, httpPutVersioned } from "./http-client";

export function createHttpLedgerRepository(): LedgerRepository {
  return {
    getSnapshot: () => httpGet<LedgerSnapshot>("/ledger/snapshot"),
    create: (input) => httpPost("/ledger/expenses", input),
    update: (expenseId, input) => httpPut(`/ledger/expenses/${encodeURIComponent(expenseId)}`, input),
    remove: (expenseId) => httpDelete(`/ledger/expenses/${encodeURIComponent(expenseId)}`),
    createCategory: (input) => httpPost("/ledger/categories", input),
    updateCategory: (categoryId, input, expectedVersion) => httpPutVersioned(`/ledger/categories/${encodeURIComponent(categoryId)}`, expectedVersion, input),
    reorderCategories: (categoryIds) => httpPut("/ledger/categories/order", { categoryIds }),
    deleteCategory: (categoryId) => httpDelete(`/ledger/categories/${encodeURIComponent(categoryId)}`),
  };
}
