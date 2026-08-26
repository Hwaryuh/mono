import type { ScrapSnapshot } from "@mono/contracts";
import type { ScrapRepository } from "../../features/scrap/scrap-repository";
import { httpDelete, httpGet, httpPost, httpPut } from "./http-client";

export function createHttpScrapRepository(): ScrapRepository {
  return {
    getSnapshot: () => httpGet<ScrapSnapshot>("/scrap/snapshot"),
    create: (input) => httpPost("/scrap/items", input),
    delete: (scrapId) => httpDelete(`/scrap/items/${encodeURIComponent(scrapId)}`),
    addTag: (tag) => httpPost("/scrap/tags", { tag }),
    addComment: (scrapId, input) => httpPost(`/scrap/items/${encodeURIComponent(scrapId)}/comments`, input),
    updateComment: (scrapId, commentId, input) =>
      httpPut(`/scrap/items/${encodeURIComponent(scrapId)}/comments/${encodeURIComponent(commentId)}`, input),
    deleteComment: (scrapId, commentId) =>
      httpDelete(`/scrap/items/${encodeURIComponent(scrapId)}/comments/${encodeURIComponent(commentId)}`),
  };
}
