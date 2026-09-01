import { InMemoryViewStateStore, type ViewStateStore } from "../../app/view-state-store";

export type ScrapViewStateStore = ViewStateStore<{ activeTag: string | null }>;

export function scrapViewStateStoreOf(): ScrapViewStateStore {
  return InMemoryViewStateStore.of({ activeTag: null });
}
