import { describe, expect, it } from "vitest";
import { createMockScrapRepository } from "./mock-scrap-repository";

describe("MockScrapRepository", () => {
  it("스크랩 생성과 새 태그를 같은 원본 상태에 저장한다", async () => {
    const repository = createMockScrapRepository();

    await repository.create({ title: "새 참고 자료", memo: "메모", url: "https://example.com", tag: "새 태그" });
    const snapshot = await repository.getSnapshot();

    expect(snapshot.tags).toContain("새 태그");
    expect(snapshot.items[0]).toMatchObject({ title: "새 참고 자료", kind: "url", tag: "새 태그" });
  });

  it("미디어 id가 있으면 이미지 스크랩으로 저장한다", async () => {
    const repository = createMockScrapRepository();
    const mediaId = "00000000-0000-4000-8000-000000000001";

    await repository.create({ title: "사진", memo: "", url: "", tag: "사진", mediaId });

    expect((await repository.getSnapshot()).items[0]).toMatchObject({ kind: "image", mediaId });
  });

  it("댓글을 대상 스크랩에만 추가한다", async () => {
    const repository = createMockScrapRepository();

    await repository.addComment("scrap-2", { text: "다시 확인하기" });
    const snapshot = await repository.getSnapshot();

    expect(snapshot.items.find((item) => item.id === "scrap-2")?.comments.at(-1)?.text).toBe("다시 확인하기");
    expect(snapshot.items.find((item) => item.id === "scrap-1")?.comments).toHaveLength(2);
  });

  it("대상 댓글만 수정하고 빈 댓글을 거부한다", async () => {
    const repository = createMockScrapRepository();

    await repository.updateComment("scrap-1", "comment-1", { text: "  마늘은 그대로 넣기  " });
    const snapshot = await repository.getSnapshot();

    expect(snapshot.items.find((item) => item.id === "scrap-1")?.comments.find((comment) => comment.id === "comment-1")?.text).toBe("마늘은 그대로 넣기");
    expect(snapshot.items.find((item) => item.id === "scrap-1")?.comments.find((comment) => comment.id === "comment-2")?.text).toContain("면은 1분");
    await expect(repository.updateComment("scrap-1", "comment-1", { text: "   " })).rejects.toThrow();
  });
});
