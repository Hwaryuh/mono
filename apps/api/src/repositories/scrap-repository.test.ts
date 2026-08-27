import { beforeEach, describe, expect, it } from "vitest";
import { createDb, type Db } from "../db/client.ts";
import { buildServer } from "../server.ts";
import { SqliteScrapRepository } from "./scrap-repository.ts";

function freshDb(): Db {
  return createDb(":memory:");
}

describe("SqliteScrapRepository", () => {
  let repo: SqliteScrapRepository;

  beforeEach(() => {
    repo = new SqliteScrapRepository(freshDb());
  });

  it("스크랩을 생성하면 태그가 자동 추가되고 kind가 url/text로 갈린다", async () => {
    await repo.create({ title: "링크 스크랩", memo: "", url: "https://example.com", tag: "읽을거리" });
    await repo.create({ title: "메모 스크랩", memo: "내용", url: "", tag: "읽을거리" });

    const snapshot = await repo.getSnapshot();
    expect(snapshot.tags).toEqual(["읽을거리"]);
    expect(snapshot.items.map((item) => item.kind)).toEqual(["text", "url"]);
  });

  it("댓글을 추가·수정·삭제하고 스크랩별로 격리한다", async () => {
    await repo.create({ title: "스크랩", memo: "", url: "", tag: "태그" });
    const scrapId = (await repo.getSnapshot()).items[0].id;

    await repo.addComment(scrapId, { text: "첫 댓글" });
    let comments = (await repo.getSnapshot()).items[0].comments;
    expect(comments.map((c) => c.text)).toEqual(["첫 댓글"]);

    await repo.updateComment(scrapId, comments[0].id, { text: "수정됨" });
    comments = (await repo.getSnapshot()).items[0].comments;
    expect(comments[0].text).toBe("수정됨");

    await repo.deleteComment(scrapId, comments[0].id);
    expect((await repo.getSnapshot()).items[0].comments).toHaveLength(0);
  });

  it("스크랩 삭제 시 댓글도 함께 지운다", async () => {
    await repo.create({ title: "스크랩", memo: "", url: "", tag: "태그" });
    const scrapId = (await repo.getSnapshot()).items[0].id;
    await repo.addComment(scrapId, { text: "댓글" });

    await repo.delete(scrapId);
    expect((await repo.getSnapshot()).items).toHaveLength(0);
  });

  it("없는 스크랩·댓글은 404 의미 오류를 던진다", async () => {
    await expect(repo.delete("nope")).rejects.toThrow("찾을 수 없습니다");
    await repo.create({ title: "스크랩", memo: "", url: "", tag: "태그" });
    const scrapId = (await repo.getSnapshot()).items[0].id;
    await expect(repo.deleteComment(scrapId, "nope")).rejects.toThrow("찾을 수 없습니다");
  });

  it("addTag는 중복을 무시한다", async () => {
    await repo.addTag("새태그");
    await repo.addTag("새태그");
    expect((await repo.getSnapshot()).tags).toEqual(["새태그"]);
  });

  it("renameTag는 태그 목록과 이를 참조하는 스크랩 항목을 함께 옮긴다", async () => {
    await repo.create({ title: "스크랩1", memo: "", url: "", tag: "요리" });
    await repo.create({ title: "스크랩2", memo: "", url: "", tag: "요리" });

    await repo.renameTag("요리", "레시피");

    const snapshot = await repo.getSnapshot();
    expect(snapshot.tags).toEqual(["레시피"]);
    expect(snapshot.items.every((item) => item.tag === "레시피")).toBe(true);
  });

  it("renameTag는 없는 태그면 명확한 오류를 던진다", async () => {
    await expect(repo.renameTag("없음", "새이름")).rejects.toThrow("찾을 수 없습니다");
  });

  it("renameTag는 다른 태그와 이름이 겹치면 거부한다", async () => {
    await repo.addTag("요리");
    await repo.addTag("레퍼런스");
    await expect(repo.renameTag("요리", "레퍼런스")).rejects.toThrow("같은 이름의 라벨이 이미 있습니다.");
  });

  it("renameTag는 자기 자신으로의 변경(공백 트림만)은 허용한다", async () => {
    await repo.addTag("요리");
    await repo.renameTag("요리", " 요리 ");
    expect((await repo.getSnapshot()).tags).toEqual(["요리"]);
  });
});

describe("scrap routes", () => {
  it("HTTP로 스크랩 생성과 댓글 흐름이 이어진다", async () => {
    const app = buildServer(freshDb());
    await app.ready();

    const created = await app.inject({ method: "POST", url: "/scrap/items", payload: { title: "HTTP 스크랩", memo: "", url: "", tag: "태그" } });
    expect(created.statusCode).toBe(201);

    const scrapId = JSON.parse((await app.inject({ method: "GET", url: "/scrap/snapshot" })).body).items[0].id;
    const commented = await app.inject({ method: "POST", url: `/scrap/items/${scrapId}/comments`, payload: { text: "댓글" } });
    expect(commented.statusCode).toBe(201);

    const missing = await app.inject({ method: "DELETE", url: "/scrap/items/nope" });
    expect(missing.statusCode).toBe(404);

    await app.close();
  });

  it("HTTP로 태그 이름을 바꾸면 스냅샷에 반영된다", async () => {
    const app = buildServer(freshDb());
    await app.ready();

    await app.inject({ method: "POST", url: "/scrap/items", payload: { title: "스크랩", memo: "", url: "", tag: "요리" } });
    const renamed = await app.inject({ method: "PUT", url: `/scrap/tags/${encodeURIComponent("요리")}`, payload: { nextTag: "레시피" } });
    expect(renamed.statusCode).toBe(200);

    const snapshot = JSON.parse((await app.inject({ method: "GET", url: "/scrap/snapshot" })).body);
    expect(snapshot.tags).toEqual(["레시피"]);
    expect(snapshot.items[0].tag).toBe("레시피");

    await app.close();
  });
});
