import { calendarCategoryOrderSchema, calendarCategoryWriteInputSchema, calendarSnapshotSchema, calendarWriteInputSchema, type CalendarCategory, type CalendarEditScope, type CalendarEvent } from "@mono/contracts";
import type { CalendarRange, CalendarRepository } from "../../features/calendar/calendar-repository";
import { addDays, expandMaster, type CalendarException } from "../../features/calendar/recurrence";
import { createMockPlatformState, type MockPlatformState } from "./mock-platform-state";

function requireCategory(categories: CalendarCategory[], categoryId: string) {
  const category = categories.find((candidate) => candidate.id === categoryId);
  if (!category) throw new Error(`일정 라벨을 찾을 수 없습니다: ${categoryId}`);
  return category;
}

function splitId(raw: string): { masterId: string; occurrenceDate: string | null } {
  const marker = raw.indexOf("::");
  return marker === -1
    ? { masterId: raw, occurrenceDate: null }
    : { masterId: raw.slice(0, marker), occurrenceDate: raw.slice(marker + 2) };
}

const overrideKeys = ["title", "startDate", "startTime", "endDate", "endTime", "location", "categoryId", "note"] as const;

class MockCalendarRepository implements CalendarRepository {
  constructor(private readonly state: MockPlatformState) {}

  private get calendar() {
    return this.state.calendar;
  }

  private requireMaster(masterId: string) {
    const master = this.calendar.events.find((candidate) => candidate.id === masterId);
    if (!master) throw new Error(`일정을 찾을 수 없습니다: ${masterId}`);
    return master;
  }

  async getSnapshot(range?: CalendarRange) {
    const from = range?.from ?? addDays(this.calendar.today, -400);
    const to = range?.to ?? addDays(this.calendar.today, 400);
    const events = this.calendar.events.flatMap((master) => expandMaster(master, from, to, this.calendar.exceptions));
    return calendarSnapshotSchema.parse({ today: this.calendar.today, categories: structuredClone(this.calendar.categories), events });
  }

  async createCategory(input: Parameters<CalendarRepository["createCategory"]>[0]) {
    const parsed = calendarCategoryWriteInputSchema.parse(input);
    this.assertUniqueCategoryName(parsed.name);
    const category = { id: `calendar-category-${this.state.nextCalendarCategoryId++}`, ...parsed };
    const fallbackIndex = this.calendar.categories.findIndex((candidate) => candidate.id === "other");
    if (fallbackIndex < 0) this.calendar.categories = [...this.calendar.categories, category];
    else this.calendar.categories = [...this.calendar.categories.slice(0, fallbackIndex), category, ...this.calendar.categories.slice(fallbackIndex)];
  }

  async updateCategory(categoryId: string, input: Parameters<CalendarRepository["updateCategory"]>[1]) {
    requireCategory(this.calendar.categories, categoryId);
    const parsed = calendarCategoryWriteInputSchema.parse(input);
    this.assertUniqueCategoryName(parsed.name, categoryId);
    this.calendar.categories = this.calendar.categories.map((category) => category.id === categoryId ? { ...category, ...parsed } : category);
  }

  async reorderCategories(categoryIds: string[]) {
    const parsed = calendarCategoryOrderSchema.parse(categoryIds);
    const currentIds = this.calendar.categories.map((category) => category.id);
    if (parsed.length !== currentIds.length || new Set(parsed).size !== currentIds.length || currentIds.some((id) => !parsed.includes(id))) {
      throw new Error("분류 순서에 현재 분류가 정확히 한 번씩 포함되어야 합니다.");
    }
    const byId = new Map(this.calendar.categories.map((category) => [category.id, category]));
    this.calendar.categories = parsed.map((id) => byId.get(id)!);
  }

  async deleteCategory(categoryId: string, replacementCategoryId: string) {
    requireCategory(this.calendar.categories, categoryId);
    if (categoryId === "other") throw new Error("기타 분류는 삭제할 수 없습니다.");
    requireCategory(this.calendar.categories, replacementCategoryId);
    if (categoryId === replacementCategoryId) throw new Error("삭제할 분류와 이동할 분류는 달라야 합니다.");
    if (this.calendar.categories.length === 1) throw new Error("마지막 분류는 삭제할 수 없습니다.");
    this.calendar.events = this.calendar.events.map((event) => event.categoryId === categoryId ? { ...event, categoryId: replacementCategoryId } : event);
    this.calendar.exceptions.forEach((exception) => {
      if (exception.override?.categoryId === categoryId) exception.override.categoryId = replacementCategoryId;
    });
    this.calendar.categories = this.calendar.categories.filter((category) => category.id !== categoryId);
  }

  async create(input: Parameters<CalendarRepository["create"]>[0]) {
    const parsed = calendarWriteInputSchema.parse(input);
    const event: CalendarEvent = { id: `event-${this.state.nextCalendarId++}`, ...parsed, recurrence: parsed.recurrence ?? null, seriesId: null, occurrenceDate: null };
    this.calendar.events = [event, ...this.calendar.events];
  }

  async update(eventId: string, input: Parameters<CalendarRepository["update"]>[1], scope?: CalendarEditScope) {
    const { masterId, occurrenceDate } = splitId(eventId);
    const master = this.requireMaster(masterId);
    const parsed = calendarWriteInputSchema.parse(input);
    const nextRecurrence = parsed.recurrence === undefined ? master.recurrence : parsed.recurrence;
    const fields = { ...parsed, recurrence: nextRecurrence };

    if (master.recurrence == null && occurrenceDate == null) {
      this.calendar.events = this.calendar.events.map((event) => event.id === masterId ? { ...event, ...fields } : event);
      return;
    }

    const slot = occurrenceDate ?? master.startDate;
    if (scope === "this") {
      this.upsertException(masterId, slot, "modified", parsed);
    } else if (scope === "future") {
      this.truncateBefore(master, slot);
      const next: CalendarEvent = { id: `event-${this.state.nextCalendarId++}`, ...fields, seriesId: null, occurrenceDate: null };
      this.calendar.events = [next, ...this.calendar.events];
    } else {
      this.calendar.events = this.calendar.events.map((event) => event.id === masterId ? { ...event, ...fields } : event);
      this.calendar.exceptions = this.calendar.exceptions.filter((exception) => exception.masterId !== masterId);
    }
  }

  async remove(eventId: string, scope?: CalendarEditScope) {
    const { masterId, occurrenceDate } = splitId(eventId);
    const master = this.requireMaster(masterId);

    if (master.recurrence == null && occurrenceDate == null) {
      this.deleteMaster(masterId);
      return;
    }

    const slot = occurrenceDate ?? master.startDate;
    if (scope === "this") {
      this.upsertException(masterId, slot, "cancelled", null);
    } else if (scope === "future") {
      this.truncateBefore(master, slot);
    } else {
      this.deleteMaster(masterId);
    }
  }

  private upsertException(masterId: string, occurrenceDate: string, kind: CalendarException["kind"], parsed: ReturnType<typeof calendarWriteInputSchema.parse> | null) {
    const override = parsed
      ? Object.fromEntries(overrideKeys.map((key) => [key, parsed[key]])) as CalendarException["override"]
      : null;
    const existing = this.calendar.exceptions.find((exception) => exception.masterId === masterId && exception.occurrenceDate === occurrenceDate);
    if (existing) {
      existing.kind = kind;
      existing.override = override;
    } else {
      this.calendar.exceptions.push({ masterId, occurrenceDate, kind, override });
    }
  }

  private truncateBefore(master: CalendarEvent, occurrenceDate: string): boolean {
    if (occurrenceDate <= master.startDate) {
      this.deleteMaster(master.id);
      return false;
    }
    const until = addDays(occurrenceDate, -1);
    this.calendar.events = this.calendar.events.map((event) =>
      event.id === master.id && event.recurrence
        ? { ...event, recurrence: { ...event.recurrence, until, count: null } }
        : event);
    this.calendar.exceptions = this.calendar.exceptions.filter(
      (exception) => !(exception.masterId === master.id && exception.occurrenceDate >= occurrenceDate));
    return true;
  }

  private deleteMaster(masterId: string) {
    this.calendar.events = this.calendar.events.filter((event) => event.id !== masterId);
    this.calendar.exceptions = this.calendar.exceptions.filter((exception) => exception.masterId !== masterId);
  }

  private assertUniqueCategoryName(name: string, exceptCategoryId?: string) {
    const normalized = name.toLocaleLowerCase("ko-KR");
    if (this.calendar.categories.some((category) => category.id !== exceptCategoryId && category.name.toLocaleLowerCase("ko-KR") === normalized)) {
      throw new Error("같은 이름의 분류가 이미 있습니다.");
    }
  }
}

export function createMockCalendarRepository(state = createMockPlatformState()): CalendarRepository {
  return new MockCalendarRepository(state);
}
