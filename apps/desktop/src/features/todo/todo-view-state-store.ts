import { InMemoryViewStateStore, type ViewStateStore } from "../../app/view-state-store";

export const todoStatusOrder = ["all", "today", "upcoming", "overdue", "done"] as const;
export type TodoStatus = (typeof todoStatusOrder)[number];

export type TodoViewState = {
  status: TodoStatus;
  labelIds: string[];
};

export type TodoViewStateStore = ViewStateStore<TodoViewState>;

export function todoViewStateStoreOf(): TodoViewStateStore {
  return InMemoryViewStateStore.of({ status: "all", labelIds: [] });
}
