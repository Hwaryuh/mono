import type { ScrapSnapshot } from "@mono/contracts";
import type { ScrapRepository } from "../../features/scrap/scrap-repository";
import { httpDelete, httpGet, httpPost, httpPut, httpPutVersioned } from "./http-client";

export function createHttpScrapRepository(): ScrapRepository {
  return {
    getSnapshot: () => httpGet<ScrapSnapshot>("/scrap/snapshot"),
    create: (input) => httpPost("/scrap/items", input),
    update: (scrapId, input) => httpPut(`/scrap/items/${encodeURIComponent(scrapId)}`, input),
    delete: (scrapId) => httpDelete(`/scrap/items/${encodeURIComponent(scrapId)}`),
    addTag: (tag) => httpPost("/scrap/tags", { tag }),
    renameTag: (tag, nextTag) => httpPut(`/scrap/tags/${encodeURIComponent(tag)}`, { nextTag }),
    deleteTag: (tag, replacementTag) => httpDelete(`/scrap/tags/${encodeURIComponent(tag)}`, { replacementTag }),
    addComment: (scrapId, input) => httpPost(`/scrap/items/${encodeURIComponent(scrapId)}/comments`, input),
    updateComment: (scrapId, commentId, input, expectedVersion) =>
      httpPutVersioned(`/scrap/items/${encodeURIComponent(scrapId)}/comments/${encodeURIComponent(commentId)}`, expectedVersion, input),
    deleteComment: (scrapId, commentId) =>
      httpDelete(`/scrap/items/${encodeURIComponent(scrapId)}/comments/${encodeURIComponent(commentId)}`),
  };
}
