import type { TodoSnapshot } from "@mono/contracts";
import type { TodoRepository } from "../../features/todo/todo-repository";
import { httpDelete, httpGet, httpPost, httpPut, httpPutVersioned } from "./http-client";

export function createHttpTodoRepository(): TodoRepository {
  return {
    getSnapshot: () => httpGet<TodoSnapshot>("/todo/snapshot"),
    create: (input) => httpPost("/todo/items", input),
    update: (itemId, input, expectedVersion) => httpPutVersioned(`/todo/items/${encodeURIComponent(itemId)}`, expectedVersion, input),
    toggleComplete: (itemId) => httpPost(`/todo/items/${encodeURIComponent(itemId)}/toggle`),
    delete: (itemId) => httpDelete(`/todo/items/${encodeURIComponent(itemId)}`),
    createLabel: (input) => httpPost("/todo/labels", input),
    updateLabel: (labelId, input, expectedVersion) => httpPutVersioned(`/todo/labels/${encodeURIComponent(labelId)}`, expectedVersion, input),
    reorderLabels: (labelIds) => httpPut("/todo/labels/order", { labelIds }),
    deleteLabel: (labelId, replacementLabelId) =>
      httpDelete(`/todo/labels/${encodeURIComponent(labelId)}`, { replacementLabelId }),
  };
}
