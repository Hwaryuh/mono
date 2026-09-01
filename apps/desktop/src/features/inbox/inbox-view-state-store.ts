import { InMemoryViewStateStore, type ViewStateStore } from "../../app/view-state-store";

export type InboxTab = "pending" | "approved" | "failed";
export const inboxTabOrder: InboxTab[] = ["pending", "approved", "failed"];

export type InboxViewStateStore = ViewStateStore<{ tab: InboxTab }>;

export function inboxViewStateStoreOf(): InboxViewStateStore {
  return InMemoryViewStateStore.of({ tab: "pending" });
}
