import { describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client.ts";
import { inboxItems, scrapItems } from "../db/schema.ts";
import { MediaReferenceRepository } from "./media-reference-repository.ts";

function freshDb(): Db {
  return createDb(":memory:");
}

describe("MediaReferenceRepository", () => {
  it("scrap의 mediaId와 inbox 이미지·영상의 mediaId를 모두 모은다", () => {
    const db = freshDb();
    db.insert(scrapItems).values({
      id: "scrap-1", seq: 1, kind: "image", title: "t", memo: "", tag: "요리", savedAt: "now", url: null, mediaId: "scrap-media-1",
    }).run();
    db.insert(inboxItems).values({
      id: "inbox-1", seq: 1, source: "image", raw: "r", target: "scrap", confidence: 0.5, status: "pending", pinned: false, receivedAt: "now",
      fieldsJson: "[]",
      imagesJson: JSON.stringify([{ mediaId: "inbox-image-1" }]),
      videosJson: JSON.stringify([{ mediaId: "inbox-video-1" }]),
    }).run();

    const ids = new MediaReferenceRepository(db).referencedMediaIds();

    expect(ids).toEqual(new Set(["scrap-media-1", "inbox-image-1", "inbox-video-1"]));
  });

  it("null mediaId와 비어있는 JSON은 무시한다", () => {
    const db = freshDb();
    db.insert(scrapItems).values({
      id: "scrap-1", seq: 1, kind: "text", title: "t", memo: "", tag: "메모", savedAt: "now", url: null, mediaId: null,
    }).run();
    db.insert(inboxItems).values({
      id: "inbox-1", seq: 1, source: "text", raw: "r", target: "todo", confidence: 0.5, status: "pending", pinned: false, receivedAt: "now",
      fieldsJson: "[]", imagesJson: null, videosJson: null,
    }).run();

    expect(new MediaReferenceRepository(db).referencedMediaIds()).toEqual(new Set());
  });
});
