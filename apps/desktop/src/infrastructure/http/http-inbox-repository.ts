import type { InboxSnapshot } from "@mono/contracts";
import type { InboxRepository } from "../../features/inbox/inbox-repository";
import { httpDelete, httpGet, httpPost, httpPut } from "./http-client";

export function createHttpInboxRepository(): InboxRepository {
  return {
    getSnapshot: () => httpGet<InboxSnapshot>("/inbox/snapshot"),
    approve: (itemId) => httpPost(`/inbox/items/${encodeURIComponent(itemId)}/approve`),
    approveHighConfidence: (minimum) => httpPost("/inbox/approve-high-confidence", { minimum }),
    update: (itemId, input) => httpPut(`/inbox/items/${encodeURIComponent(itemId)}`, input),
    discard: (itemId) => httpDelete(`/inbox/items/${encodeURIComponent(itemId)}`),
  };
}
