import {
  inboxSnapshotSchema,
  inboxUpdateInputSchema,
  ledgerWriteInputSchema,
  type InboxItem,
  type InboxUpdateInput,
} from "@mono/contracts";
import type { InboxRepository } from "../../features/inbox/inbox-repository";
import { createMockPlatformState, type MockPlatformState } from "./mock-platform-state";

function requireItem(items: InboxItem[], itemId: string) {
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`수집함 항목을 찾을 수 없습니다: ${itemId}`);
  return item;
}

function fieldValue(item: InboxItem, label: string) {
  return item.fields.find((field) => field.label === label)?.value.trim() ?? "";
}

function labelValue(item: InboxItem) {
  return fieldValue(item, "라벨") || fieldValue(item, "분류") || fieldValue(item, "태그");
}

function approveItem(state: MockPlatformState, itemId: string) {
  const item = requireItem(state.inbox.items, itemId);
  if (item.status === "approved") return;

  if (item.target === "todo") {
    const labelName = labelValue(item);
    const label = state.todo.labels.find((candidate) => candidate.name === labelName) ?? state.todo.labels.find((candidate) => candidate.id === "work")!;
    const due = fieldValue(item, "마감");
    const dateMatch = due.match(/\d{4}-\d{2}-\d{2}/);
    const timeMatch = due.match(/\d{1,2}:\d{2}/);
    state.todo.items = [
      {
        id: `task-${state.nextTodoId++}`,
        title: fieldValue(item, "제목") || item.raw,
        labelId: label.id,
        dueDate: due === "오늘" ? state.todo.today : dateMatch?.[0] ?? null,
        dueTime: timeMatch?.[0] ?? null,
        note: fieldValue(item, "메모"),
        done: false,
        completedAt: null,
        routineId: null,
        occurrenceDate: null,
      },
      ...state.todo.items,
    ];
  }

  if (item.target === "calendar") {
    const categoryName = labelValue(item);
    const category = state.calendar.categories.find((candidate) => candidate.name === categoryName)
      ?? state.calendar.categories.find((candidate) => candidate.id === "hobby")
      ?? state.calendar.categories[0]!;
    const schedule = fieldValue(item, "일시");
    const dates = schedule.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    const times = schedule.match(/\d{1,2}:\d{2}/g) ?? [];
    state.calendar.events = [{
      id: `event-${state.nextCalendarId++}`,
      title: fieldValue(item, "제목") || item.raw,
      startDate: dates[0] ?? state.calendar.today,
      startTime: times[0] ?? null,
      endDate: dates[1] ?? dates[0] ?? state.calendar.today,
      endTime: times[1] ?? times[0] ?? null,
      location: fieldValue(item, "장소"),
      categoryId: category.id,
      note: fieldValue(item, "메모"),
      recurrence: null,
      seriesId: null,
      occurrenceDate: null,
    }, ...state.calendar.events];
  }

  if (item.target === "scrap") {
    const tag = labelValue(item) || "수집";
    if (!state.scrap.tags.includes(tag)) state.scrap.tags.push(tag);
    // 미디어 원본은 media 테이블에 있고, 여기선 참조 id만 인계한다.
    const mediaId = item.images?.[0]?.mediaId ?? item.videos?.[0]?.mediaId ?? null;
    state.scrap.items = [{
      id: `scrap-${state.nextScrapId++}`,
      kind: item.source === "url" ? "url" : item.source === "image" ? "image" : item.source === "video" ? "video" : "text",
      title: fieldValue(item, "제목") || item.raw,
      memo: fieldValue(item, "메모") || item.raw,
      tag,
      savedAt: "방금",
      url: item.source === "url" ? item.raw : null,
      mediaId,
      fileName: null,
      fileSize: null,
      comments: [],
    }, ...state.scrap.items];
  }

  if (item.target === "ledger") {
    const categoryName = labelValue(item);
    const category = state.ledger.categories.find((candidate) => candidate.name === categoryName)
      ?? state.ledger.categories.find((candidate) => candidate.id === "other")
      ?? state.ledger.categories[0]!;
    const input = ledgerWriteInputSchema.parse({
      title: fieldValue(item, "항목") || fieldValue(item, "제목") || item.raw,
      amountWon: fieldValue(item, "금액"),
      date: fieldValue(item, "날짜") || state.ledger.today,
      categoryId: category.id,
      note: fieldValue(item, "메모"),
    });
    state.ledger.expenses = [{ id: `expense-${state.nextLedgerId++}`, ...input }, ...state.ledger.expenses];
  }

  state.inbox.items = state.inbox.items.map((candidate) => candidate.id === itemId
    ? { ...candidate, status: "approved" as const }
    : candidate);
}

class MockInboxRepository implements InboxRepository {
  constructor(private readonly state: MockPlatformState) {}

  async getSnapshot() {
    return inboxSnapshotSchema.parse(structuredClone(this.state.inbox));
  }

  async approve(itemId: string) {
    approveItem(this.state, itemId);
  }

  async approveHighConfidence(minimum: number) {
    const itemIds = this.state.inbox.items
      .filter((item) => item.status === "pending" && item.confidence >= minimum)
      .map((item) => item.id);
    itemIds.forEach((itemId) => approveItem(this.state, itemId));
  }

  async update(itemId: string, input: InboxUpdateInput) {
    const itemToUpdate = requireItem(this.state.inbox.items, itemId);
    const parsed = inboxUpdateInputSchema.parse(input);
    if (itemToUpdate.source === "video" && parsed.target !== "scrap") {
      throw new Error("영상은 스크랩 모듈로만 저장할 수 있습니다.");
    }
    const scoredFields = parsed.fields.filter((field) => field.confidence !== undefined);
    const confidence = scoredFields.length > 0
      ? scoredFields.reduce((sum, field) => sum + field.confidence!, 0) / scoredFields.length
      : 0.9;

    this.state.inbox.items = this.state.inbox.items.map((item) =>
      item.id === itemId
        ? { ...item, target: parsed.target, fields: parsed.fields, confidence, status: "pending" as const, pinned: item.source === "video" }
        : item,
    );
  }

  async discard(itemId: string) {
    requireItem(this.state.inbox.items, itemId);
    this.state.inbox.items = this.state.inbox.items.filter((item) => item.id !== itemId);
  }
}

export function createMockInboxRepository(state = createMockPlatformState()): InboxRepository {
  return new MockInboxRepository(state);
}
