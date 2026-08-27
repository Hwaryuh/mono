import { randomUUID } from "node:crypto";
import {
  scrapCommentInputSchema,
  scrapSnapshotSchema,
  scrapWriteInputSchema,
  type ScrapCommentInput,
  type ScrapSnapshot,
  type ScrapWriteInput,
} from "@mono/contracts";
import { asc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { SCRAP_OTHER_TAG, scrapComments, scrapItems, scrapTags } from "../db/schema.ts";

// 서버 Scrap 저장소. 데스크톱 ScrapRepository 인터페이스와 같은 op·에러 시맨틱을 만족한다.
// 파일 업로드·FileStore 연결은 이번 슬라이스 범위 밖이다(§9 결정). mediaId는 참조 값만 저장한다.
export class SqliteScrapRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async getSnapshot(): Promise<ScrapSnapshot> {
    const tags = this.db.select().from(scrapTags).all().map((row) => row.tag);
    const items = this.db.select().from(scrapItems).orderBy(sql`${scrapItems.seq} DESC`).all();
    const comments = this.db.select().from(scrapComments).orderBy(asc(scrapComments.seq)).all();

    return scrapSnapshotSchema.parse({
      tags,
      items: items.map(({ seq: _seq, ...item }) => ({
        ...item,
        comments: comments.filter((comment) => comment.scrapId === item.id).map(({ scrapId: _scrapId, seq: _cseq, ...comment }) => comment),
      })),
    });
  }

  async create(input: ScrapWriteInput): Promise<void> {
    const parsed = scrapWriteInputSchema.parse(input);
    this.db.transaction((tx) => {
      tx.insert(scrapTags).values({ tag: parsed.tag }).onConflictDoNothing().run();
      const nextSeq = (tx.select({ max: sql<number>`COALESCE(MAX(${scrapItems.seq}), 0)` }).from(scrapItems).get()?.max ?? 0) + 1;
      tx.insert(scrapItems).values({
        id: randomUUID(),
        seq: nextSeq,
        kind: parsed.url ? "url" : "text",
        title: parsed.title,
        memo: parsed.memo,
        tag: parsed.tag,
        savedAt: new Date().toISOString(),
        url: parsed.url || null,
        mediaId: null,
      }).run();
    });
  }

  async delete(scrapId: string): Promise<void> {
    this.requireScrap(scrapId);
    this.db.transaction((tx) => {
      tx.delete(scrapComments).where(eq(scrapComments.scrapId, scrapId)).run();
      tx.delete(scrapItems).where(eq(scrapItems.id, scrapId)).run();
    });
  }

  async addTag(tag: string): Promise<void> {
    const parsed = scrapWriteInputSchema.shape.tag.parse(tag);
    this.db.insert(scrapTags).values({ tag: parsed }).onConflictDoNothing().run();
  }

  // 스크랩 태그는 todo 라벨과 달리 별도 id가 없다 — 문자열 자체가 기본키다.
  // 그래서 이름을 바꾸는 건 곧 기본키를 바꾸는 것이고, 이를 참조하는 scrapItems.tag도
  // 함께 옮겨줘야 한다(FK 제약이 없어 DB가 대신 해주지 않는다).
  // Todo 라벨 삭제(deleteLabel)와 같은 패턴 — 유저가 고른 대체 태그로 스크랩을 옮긴 뒤 지운다.
  // "기타"는 ledger의 "other"처럼 예약값이라 삭제 대상이 될 수 없다(항상 대체 후보로는 남는다).
  async deleteTag(tag: string, replacementTag: string): Promise<void> {
    this.requireTag(tag);
    if (tag === SCRAP_OTHER_TAG) throw new Error("기타 라벨은 삭제할 수 없습니다.");
    this.requireTag(replacementTag);
    if (tag === replacementTag) throw new Error("삭제할 라벨과 이동할 라벨은 달라야 합니다.");
    this.db.transaction((tx) => {
      tx.update(scrapItems).set({ tag: replacementTag }).where(eq(scrapItems.tag, tag)).run();
      tx.delete(scrapTags).where(eq(scrapTags.tag, tag)).run();
    });
  }

  async renameTag(tag: string, nextTag: string): Promise<void> {
    const parsed = scrapWriteInputSchema.shape.tag.parse(nextTag);
    this.requireTag(tag);
    if (parsed !== tag) this.assertUniqueTagName(parsed);
    this.db.transaction((tx) => {
      tx.update(scrapTags).set({ tag: parsed }).where(eq(scrapTags.tag, tag)).run();
      tx.update(scrapItems).set({ tag: parsed }).where(eq(scrapItems.tag, tag)).run();
    });
  }

  async addComment(scrapId: string, input: ScrapCommentInput): Promise<void> {
    this.requireScrap(scrapId);
    const parsed = scrapCommentInputSchema.parse(input);
    const nextSeq = (this.db.select({ max: sql<number>`COALESCE(MAX(${scrapComments.seq}), 0)` }).from(scrapComments).where(eq(scrapComments.scrapId, scrapId)).get()?.max ?? 0) + 1;
    this.db.insert(scrapComments).values({ id: randomUUID(), scrapId, seq: nextSeq, createdAt: new Date().toISOString(), text: parsed.text }).run();
  }

  async updateComment(scrapId: string, commentId: string, input: ScrapCommentInput): Promise<void> {
    this.requireScrap(scrapId);
    this.requireComment(scrapId, commentId);
    const parsed = scrapCommentInputSchema.parse(input);
    this.db.update(scrapComments).set({ text: parsed.text }).where(eq(scrapComments.id, commentId)).run();
  }

  async deleteComment(scrapId: string, commentId: string): Promise<void> {
    this.requireScrap(scrapId);
    this.requireComment(scrapId, commentId);
    this.db.delete(scrapComments).where(eq(scrapComments.id, commentId)).run();
  }

  private requireScrap(scrapId: string) {
    const scrap = this.db.select().from(scrapItems).where(eq(scrapItems.id, scrapId)).get();
    if (!scrap) throw new Error(`스크랩을 찾을 수 없습니다: ${scrapId}`);
    return scrap;
  }

  private requireComment(scrapId: string, commentId: string) {
    const comment = this.db.select().from(scrapComments).where(eq(scrapComments.id, commentId)).get();
    if (!comment || comment.scrapId !== scrapId) throw new Error(`댓글을 찾을 수 없습니다: ${commentId}`);
    return comment;
  }

  private requireTag(tag: string) {
    const row = this.db.select().from(scrapTags).where(eq(scrapTags.tag, tag)).get();
    if (!row) throw new Error(`라벨을 찾을 수 없습니다: ${tag}`);
  }

  private assertUniqueTagName(tag: string) {
    const clash = this.db.select().from(scrapTags).where(eq(scrapTags.tag, tag)).get();
    if (clash) throw new Error("같은 이름의 라벨이 이미 있습니다.");
  }
}
