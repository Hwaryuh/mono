import { InMemoryViewStateStore, type ViewStateStore } from "../../app/view-state-store";

export type LedgerViewStateStore = ViewStateStore<{ viewMonth: string | null }>;

export function ledgerViewStateStoreOf(): LedgerViewStateStore {
  return InMemoryViewStateStore.of({ viewMonth: null });
}
