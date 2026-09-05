import type { ScrapItem } from "@mono/contracts";
import { describe, expect, it } from "vitest";
import { sortItems } from "./scrap-sort";

function item(over: Partial<ScrapItem>): ScrapItem {
  return { id: "x", kind: "text", title: "", memo: "", tag: "수집", savedAt: "2026-01-01T00:00:00Z", url: null, mediaId: null, fileName: null, fileSize: null, comments: [], ...over };
}

const a = item({ id: "a", title: "가나다", savedAt: "2026-03-01T00:00:00Z", comments: [] });
const b = item({ id: "b", title: "하나", savedAt: "2026-01-15T00:00:00Z", comments: [{ id: "c1", createdAt: "", text: "", file: null }, { id: "c2", createdAt: "", text: "", file: null }] });
const c = item({ id: "c", title: "다라마", savedAt: "2026-05-20T00:00:00Z", comments: [{ id: "c3", createdAt: "", text: "", file: null }] });

const ids = (items: ScrapItem[]) => items.map((i) => i.id);

describe("sortItems", () => {
  it("recent: newest savedAt first", () => {
    expect(ids(sortItems([a, b, c], "recent"))).toEqual(["c", "a", "b"]);
  });

  it("oldest: oldest savedAt first", () => {
    expect(ids(sortItems([a, b, c], "oldest"))).toEqual(["b", "a", "c"]);
  });

  it("title: Korean alphabetical order", () => {
    expect(ids(sortItems([a, b, c], "title"))).toEqual(["a", "c", "b"]);
  });

  it("comments: most comments first, ties broken by newest first", () => {
    expect(ids(sortItems([a, b, c], "comments"))).toEqual(["b", "c", "a"]);
  });

  it("does not mutate the input array", () => {
    const input = [a, b, c];
    sortItems(input, "oldest");
    expect(ids(input)).toEqual(["a", "b", "c"]);
  });
});
