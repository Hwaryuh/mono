import type { ScrapCommentInput, ScrapSnapshot, ScrapWriteInput } from "@mono/contracts";

export interface ScrapCommentRepository {
  addComment(scrapId: string, input: ScrapCommentInput): Promise<void>;
  updateComment(scrapId: string, commentId: string, input: ScrapCommentInput): Promise<void>;
  deleteComment(scrapId: string, commentId: string): Promise<void>;
}

export interface ScrapRepository extends ScrapCommentRepository {
  getSnapshot(): Promise<ScrapSnapshot>;
  create(input: ScrapWriteInput): Promise<void>;
  update(scrapId: string, input: ScrapWriteInput): Promise<void>;
  delete(scrapId: string): Promise<void>;
  addTag(tag: string): Promise<void>;
  renameTag(tag: string, nextTag: string): Promise<void>;
  deleteTag(tag: string, replacementTag: string): Promise<void>;
}
