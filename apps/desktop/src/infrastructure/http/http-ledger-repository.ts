import type { LedgerSnapshot } from "@mono/contracts";
import type { LedgerRepository } from "../../features/ledger/ledger-repository";
import { httpDelete, httpGet, httpPost, httpPut } from "./http-client";

export function createHttpLedgerRepository(): LedgerRepository {
  return {
    getSnapshot: () => httpGet<LedgerSnapshot>("/ledger/snapshot"),
    create: (input) => httpPost("/ledger/expenses", input),
    createCategory: (input) => httpPost("/ledger/categories", input),
    updateCategory: (categoryId, input) => httpPut(`/ledger/categories/${encodeURIComponent(categoryId)}`, input),
    reorderCategories: (categoryIds) => httpPut("/ledger/categories/order", { categoryIds }),
    deleteCategory: (categoryId) => httpDelete(`/ledger/categories/${encodeURIComponent(categoryId)}`),
  };
}
