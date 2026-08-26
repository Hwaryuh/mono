import { randomUUID } from "node:crypto";
import {
  inboxSnapshotSchema,
  inboxUpdateInputSchema,
  ledgerWriteInputSchema,
  type InboxField,
  type InboxSnapshot,
  type InboxUpdateInput,
} from "@mono/contracts";
import { currentIsoDate } from "@mono/domain";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import {
  calendarCategories,
  calendarEvents,
  inboxItems,
  ledgerCategories,
  ledgerExpenses,
  LEDGER_OTHER_CATEGORY_ID,
  scrapItems,
  scrapTags,
  todoItems,
  todoLabels,
} from "../db/schema.ts";

function fieldValue(fields: InboxField[], label: string) {
  return fields.find((field) => field.label === label)?.value.trim() ?? "";
}

function labelValue(fields: InboxField[]) {
  return fieldValue(fields, "라벨") || fieldValue(fields, "분류") || fieldValue(fields, "태그");
}

// AI가 골라준 라벨명을 유저 라벨과 대조할 때 공백·대소문자 차이는 무시한다. AI에 기존 목록을
// 주입해도 "집안 일" vs "집안일" 같은 사소한 편차가 기본버킷 낙하를 유발하는 걸 막는다.
function normalizeName(name: string): string {
  return name.replace(/\s+/g, "").toLowerCase();
}

function findByName<T extends { name: string }>(candidates: T[], target: string): T | undefined {
  if (target.trim().length === 0) return undefined;
  const wanted = normalizeName(target);
  return candidates.find((candidate) => normalizeName(candidate.name) === wanted);
}

type InboxRow = typeof inboxItems.$inferSelect;

function toItem(row: InboxRow) {
  return {
    id: row.id,
    source: row.source,
    raw: row.raw,
    target: row.target,
    confidence: row.confidence,
    status: row.status,
    pinned: row.pinned,
    receivedAt: row.receivedAt,
    fields: JSON.parse(row.fieldsJson) as InboxField[],
    images: row.imagesJson ? JSON.parse(row.imagesJson) : undefined,
    videos: row.videosJson ? JSON.parse(row.videosJson) : undefined,
  };
}

// 서버 Inbox 저장소. mock과 마찬가지로 승인 시 대상 경계 테이블에 직접 쓴다.
// Scrap은 kind(image/video/url/text)·mediaId를 ScrapRepository.create가 지원하지 않아
// (그건 텍스트·URL 캡처 전용) sibling repo를 거치지 않고 mock처럼 직접 테이블에 쓴다.
export class SqliteInboxRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async getSnapshot(): Promise<InboxSnapshot> {
    const rows = this.db.select().from(inboxItems).orderBy(desc(inboxItems.seq)).all();
    return inboxSnapshotSchema.parse({ items: rows.map(toItem) });
  }

  async approve(itemId: string): Promise<void> {
    this.approveItem(itemId);
  }

  async approveHighConfidence(minimum: number): Promise<void> {
    const rows = this.db.select().from(inboxItems).where(eq(inboxItems.status, "pending")).all()
      .filter((row) => row.confidence >= minimum);
    rows.forEach((row) => this.approveItem(row.id));
  }

  async update(itemId: string, input: InboxUpdateInput): Promise<void> {
    const row = this.requireItem(itemId);
    const parsed = inboxUpdateInputSchema.parse(input);
    if (row.source === "video" && parsed.target !== "scrap") {
      throw new Error("영상은 스크랩 모듈로만 저장할 수 있습니다.");
    }
    const scoredFields = parsed.fields.filter((field) => field.confidence !== undefined);
    const confidence = scoredFields.length > 0
      ? scoredFields.reduce((sum, field) => sum + field.confidence!, 0) / scoredFields.length
      : 0.9;

    this.db.update(inboxItems).set({
      target: parsed.target,
      fieldsJson: JSON.stringify(parsed.fields),
      confidence,
      status: "pending",
      pinned: row.source === "video",
    }).where(eq(inboxItems.id, itemId)).run();
  }

  async discard(itemId: string): Promise<void> {
    this.requireItem(itemId);
    this.db.delete(inboxItems).where(eq(inboxItems.id, itemId)).run();
  }

  private approveItem(itemId: string) {
    const row = this.requireItem(itemId);
    if (row.status === "approved") return;
    const fields = JSON.parse(row.fieldsJson) as InboxField[];

    if (row.target === "todo") this.approveToTodo(row, fields);
    if (row.target === "calendar") this.approveToCalendar(row, fields);
    if (row.target === "scrap") this.approveToScrap(row, fields);
    if (row.target === "ledger") this.approveToLedger(row, fields);

    this.db.update(inboxItems).set({ status: "approved" }).where(eq(inboxItems.id, itemId)).run();
  }

  private approveToTodo(row: InboxRow, fields: InboxField[]) {
    const labelName = labelValue(fields);
    const labels = this.db.select().from(todoLabels).orderBy(asc(todoLabels.orderIndex)).all();
    const label = findByName(labels, labelName) ?? labels.find((candidate) => candidate.id === "work") ?? labels[0];
    if (!label) throw new Error("할 일 라벨이 없어 승인할 수 없습니다. 먼저 라벨을 만드세요.");
    const due = fieldValue(fields, "마감");
    const dateMatch = due.match(/\d{4}-\d{2}-\d{2}/);
    const timeMatch = due.match(/\d{1,2}:\d{2}/);
    const nextSeq = (this.db.select({ max: sql<number>`COALESCE(MAX(${todoItems.seq}), 0)` }).from(todoItems).get()?.max ?? 0) + 1;
    this.db.insert(todoItems).values({
      id: randomUUID(),
      seq: nextSeq,
      title: fieldValue(fields, "제목") || row.raw,
      labelId: label.id,
      dueDate: due === "오늘" ? currentIsoDate() : dateMatch?.[0] ?? null,
      dueTime: timeMatch?.[0] ?? null,
      note: fieldValue(fields, "메모"),
      done: false,
      completedAt: null,
      routineId: null,
      occurrenceDate: null,
    }).run();
  }

  private approveToCalendar(row: InboxRow, fields: InboxField[]) {
    const categoryName = labelValue(fields);
    const categories = this.db.select().from(calendarCategories).orderBy(asc(calendarCategories.orderIndex)).all();
    const category = findByName(categories, categoryName) ?? categories.find((candidate) => candidate.id === "hobby") ?? categories[0];
    if (!category) throw new Error("일정 분류가 없어 승인할 수 없습니다. 먼저 분류를 만드세요.");
    const schedule = fieldValue(fields, "일시");
    const dates = schedule.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    const times = schedule.match(/\d{1,2}:\d{2}/g) ?? [];
    const today = currentIsoDate();
    const nextSeq = (this.db.select({ max: sql<number>`COALESCE(MAX(${calendarEvents.seq}), 0)` }).from(calendarEvents).get()?.max ?? 0) + 1;
    this.db.insert(calendarEvents).values({
      id: randomUUID(),
      seq: nextSeq,
      title: fieldValue(fields, "제목") || row.raw,
      startDate: dates[0] ?? today,
      startTime: times[0] ?? null,
      endDate: dates[1] ?? dates[0] ?? today,
      endTime: times[1] ?? times[0] ?? null,
      location: fieldValue(fields, "장소"),
      categoryId: category.id,
      note: fieldValue(fields, "메모"),
    }).run();
  }

  private approveToScrap(row: InboxRow, fields: InboxField[]) {
    const tag = labelValue(fields) || "수집";
    this.db.insert(scrapTags).values({ tag }).onConflictDoNothing().run();
    const images = row.imagesJson ? JSON.parse(row.imagesJson) : [];
    const videos = row.videosJson ? JSON.parse(row.videosJson) : [];
    const mediaId = images[0]?.mediaId ?? videos[0]?.mediaId ?? null;
    const nextSeq = (this.db.select({ max: sql<number>`COALESCE(MAX(${scrapItems.seq}), 0)` }).from(scrapItems).get()?.max ?? 0) + 1;
    this.db.insert(scrapItems).values({
      id: randomUUID(),
      seq: nextSeq,
      kind: row.source === "url" ? "url" : row.source === "image" ? "image" : row.source === "video" ? "video" : "text",
      title: fieldValue(fields, "제목") || row.raw,
      memo: fieldValue(fields, "메모") || row.raw,
      tag,
      savedAt: new Date().toISOString(),
      url: row.source === "url" ? row.raw : null,
      mediaId,
    }).run();
  }

  private approveToLedger(row: InboxRow, fields: InboxField[]) {
    const categoryName = labelValue(fields);
    const categories = this.db.select().from(ledgerCategories).orderBy(asc(ledgerCategories.orderIndex)).all();
    const category = findByName(categories, categoryName)
      ?? categories.find((candidate) => candidate.id === LEDGER_OTHER_CATEGORY_ID)
      ?? categories[0];
    if (!category) throw new Error("가계부 분류가 없어 승인할 수 없습니다.");
    const input = ledgerWriteInputSchema.parse({
      title: fieldValue(fields, "항목") || fieldValue(fields, "제목") || row.raw,
      amountWon: fieldValue(fields, "금액"),
      date: fieldValue(fields, "날짜") || currentIsoDate(),
      categoryId: category.id,
      note: fieldValue(fields, "메모"),
    });
    const nextSeq = (this.db.select({ max: sql<number>`COALESCE(MAX(${ledgerExpenses.seq}), 0)` }).from(ledgerExpenses).get()?.max ?? 0) + 1;
    this.db.insert(ledgerExpenses).values({ id: randomUUID(), seq: nextSeq, ...input }).run();
  }

  private requireItem(itemId: string) {
    const row = this.db.select().from(inboxItems).where(eq(inboxItems.id, itemId)).get();
    if (!row) throw new Error(`수집함 항목을 찾을 수 없습니다: ${itemId}`);
    return row;
  }
}
