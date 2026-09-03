import { scrapCommentInputSchema, scrapSnapshotSchema, scrapWriteInputSchema, type ScrapKind } from "@mono/contracts";
import type { ScrapRepository } from "../../features/scrap/scrap-repository";
import { createMockPlatformState, type MockPlatformState } from "./mock-platform-state";

function scrapKind(parsed: { mediaId?: string | null; fileName?: string | null; url: string }): ScrapKind {
  if (parsed.fileName) return "file";
  if (parsed.mediaId) return "image";
  return parsed.url ? "url" : "text";
}

function requireScrap(state: MockPlatformState, scrapId: string) {
  const scrap = state.scrap.items.find((candidate) => candidate.id === scrapId);
  if (!scrap) throw new Error(`스크랩을 찾을 수 없습니다: ${scrapId}`);
  return scrap;
}

class MockScrapRepository implements ScrapRepository {
  constructor(private readonly state: MockPlatformState) {}

  async getSnapshot() {
    return scrapSnapshotSchema.parse(structuredClone(this.state.scrap));
  }

  async create(input: Parameters<ScrapRepository["create"]>[0]) {
    const parsed = scrapWriteInputSchema.parse(input);
    if (!this.state.scrap.tags.includes(parsed.tag)) this.state.scrap.tags.push(parsed.tag);
    this.state.scrap.items = [{
      id: `scrap-${this.state.nextScrapId++}`,
      kind: scrapKind(parsed),
      title: parsed.title,
      memo: parsed.memo,
      tag: parsed.tag,
      savedAt: "방금",
      url: parsed.url || null,
      mediaId: parsed.mediaId ?? null,
      fileName: parsed.fileName ?? null,
      fileSize: parsed.fileSize ?? null,
      comments: [],
    }, ...this.state.scrap.items];
  }

  async update(scrapId: string, input: Parameters<ScrapRepository["update"]>[1]) {
    const scrap = requireScrap(this.state, scrapId);
    const parsed = scrapWriteInputSchema.parse(input);
    if (!this.state.scrap.tags.includes(parsed.tag)) this.state.scrap.tags.push(parsed.tag);
    scrap.title = parsed.title;
    scrap.memo = parsed.memo;
    scrap.tag = parsed.tag;
    scrap.url = parsed.url || null;
    scrap.mediaId = parsed.mediaId ?? null;
    scrap.fileName = parsed.fileName ?? null;
    scrap.fileSize = parsed.fileSize ?? null;
    scrap.kind = scrapKind(parsed);
  }

  async delete(scrapId: string) {
    requireScrap(this.state, scrapId);
    this.state.scrap.items = this.state.scrap.items.filter((candidate) => candidate.id !== scrapId);
  }

  async addTag(tag: string) {
    const parsed = scrapWriteInputSchema.shape.tag.parse(tag);
    if (!this.state.scrap.tags.includes(parsed)) this.state.scrap.tags.push(parsed);
  }

  async renameTag(tag: string, nextTag: string) {
    const parsed = scrapWriteInputSchema.shape.tag.parse(nextTag);
    const index = this.state.scrap.tags.indexOf(tag);
    if (index === -1) throw new Error(`라벨을 찾을 수 없습니다: ${tag}`);
    if (parsed !== tag && this.state.scrap.tags.includes(parsed)) throw new Error("같은 이름의 라벨이 이미 있습니다.");
    this.state.scrap.tags[index] = parsed;
    this.state.scrap.items.forEach((item) => { if (item.tag === tag) item.tag = parsed; });
  }

  async deleteTag(tag: string, replacementTag: string) {
    if (!this.state.scrap.tags.includes(tag)) throw new Error(`라벨을 찾을 수 없습니다: ${tag}`);
    if (tag === "기타") throw new Error("기타 라벨은 삭제할 수 없습니다.");
    if (!this.state.scrap.tags.includes(replacementTag)) throw new Error(`라벨을 찾을 수 없습니다: ${replacementTag}`);
    if (tag === replacementTag) throw new Error("삭제할 라벨과 이동할 라벨은 달라야 합니다.");
    this.state.scrap.items.forEach((item) => { if (item.tag === tag) item.tag = replacementTag; });
    this.state.scrap.tags = this.state.scrap.tags.filter((candidate) => candidate !== tag);
  }

  async addComment(scrapId: string, input: Parameters<ScrapRepository["addComment"]>[1]) {
    const scrap = requireScrap(this.state, scrapId);
    const parsed = scrapCommentInputSchema.parse(input);
    scrap.comments.push({ id: `comment-${this.state.nextScrapCommentId++}`, createdAt: "오늘", text: parsed.text, file: parsed.file ?? null });
  }

  async updateComment(scrapId: string, commentId: string, input: Parameters<ScrapRepository["updateComment"]>[2]) {
    const scrap = requireScrap(this.state, scrapId);
    const comment = scrap.comments.find((candidate) => candidate.id === commentId);
    if (!comment) throw new Error(`댓글을 찾을 수 없습니다: ${commentId}`);
    const parsed = scrapCommentInputSchema.parse(input);
    comment.text = parsed.text;
  }

  async deleteComment(scrapId: string, commentId: string) {
    const scrap = requireScrap(this.state, scrapId);
    if (!scrap.comments.some((candidate) => candidate.id === commentId)) throw new Error(`댓글을 찾을 수 없습니다: ${commentId}`);
    scrap.comments = scrap.comments.filter((candidate) => candidate.id !== commentId);
  }
}

export function createMockScrapRepository(state = createMockPlatformState()): ScrapRepository {
  return new MockScrapRepository(state);
}
