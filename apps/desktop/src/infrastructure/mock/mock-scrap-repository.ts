import { scrapCommentInputSchema, scrapSnapshotSchema, scrapWriteInputSchema } from "@mono/contracts";
import type { ScrapRepository } from "../../features/scrap/scrap-repository";
import { createMockPlatformState, type MockPlatformState } from "./mock-platform-state";

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
      kind: parsed.url ? "url" : "text",
      title: parsed.title,
      memo: parsed.memo,
      tag: parsed.tag,
      savedAt: "방금",
      url: parsed.url || null,
      mediaId: null,
      comments: [],
    }, ...this.state.scrap.items];
  }

  async delete(scrapId: string) {
    requireScrap(this.state, scrapId);
    this.state.scrap.items = this.state.scrap.items.filter((candidate) => candidate.id !== scrapId);
  }

  async addTag(tag: string) {
    const parsed = scrapWriteInputSchema.shape.tag.parse(tag);
    if (!this.state.scrap.tags.includes(parsed)) this.state.scrap.tags.push(parsed);
  }

  async addComment(scrapId: string, input: Parameters<ScrapRepository["addComment"]>[1]) {
    const scrap = requireScrap(this.state, scrapId);
    const parsed = scrapCommentInputSchema.parse(input);
    scrap.comments.push({ id: `comment-${this.state.nextScrapCommentId++}`, createdAt: "오늘", text: parsed.text });
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
