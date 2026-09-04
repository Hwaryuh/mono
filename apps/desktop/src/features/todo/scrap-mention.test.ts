import { describe, expect, it } from "vitest";
import { extractScrapMentionIds, parseScrapMentions, resolveScrapMentions, scrapMentionToken } from "./scrap-mention";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("scrap-mention", () => {
  it("splits text and mentions in order", () => {
    const text = `앞 ${scrapMentionToken(A)} 뒤 ${scrapMentionToken(B)}`;
    expect(parseScrapMentions(text)).toEqual([
      { type: "text", text: "앞 " },
      { type: "mention", id: A },
      { type: "text", text: " 뒤 " },
      { type: "mention", id: B },
    ]);
  });

  it("returns plain text unchanged", () => {
    expect(parseScrapMentions("그냥 메모")).toEqual([{ type: "text", text: "그냥 메모" }]);
  });

  it("extracts ids in document order", () => {
    expect(extractScrapMentionIds(`${scrapMentionToken(B)}${scrapMentionToken(A)}`)).toEqual([B, A]);
  });

  it("resolves to current scrap titles, not the stored name", () => {
    const text = `회의 ${scrapMentionToken(A)} 참고`;
    expect(resolveScrapMentions(text, [{ id: A, title: "새 제목" }])).toBe("회의 #새 제목 참고");
  });

  it("marks missing and untitled scraps", () => {
    expect(resolveScrapMentions(scrapMentionToken(A), [])).toBe("#(삭제된 스크랩)");
    expect(resolveScrapMentions(scrapMentionToken(A), [{ id: A, title: "  " }])).toBe("#제목 없음");
  });

  it("ignores malformed tokens", () => {
    expect(parseScrapMentions("@[scrap:빈 칸]")).toEqual([{ type: "text", text: "@[scrap:빈 칸]" }]);
    expect(parseScrapMentions("@[scrap:]")).toEqual([{ type: "text", text: "@[scrap:]" }]);
  });
});
