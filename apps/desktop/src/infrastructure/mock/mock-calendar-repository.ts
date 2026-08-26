import { calendarCategoryOrderSchema, calendarCategoryWriteInputSchema, calendarSnapshotSchema, calendarWriteInputSchema, type CalendarCategory } from "@mono/contracts";
import type { CalendarRepository } from "../../features/calendar/calendar-repository";
import { createMockPlatformState, type MockPlatformState } from "./mock-platform-state";

function requireEvent(state: MockPlatformState, eventId: string) {
  const event = state.calendar.events.find((candidate) => candidate.id === eventId);
  if (!event) throw new Error(`일정을 찾을 수 없습니다: ${eventId}`);
  return event;
}

function requireCategory(categories: CalendarCategory[], categoryId: string) {
  const category = categories.find((candidate) => candidate.id === categoryId);
  if (!category) throw new Error(`일정 라벨을 찾을 수 없습니다: ${categoryId}`);
  return category;
}

class MockCalendarRepository implements CalendarRepository {
  constructor(private readonly state: MockPlatformState) {}

  async getSnapshot() {
    return calendarSnapshotSchema.parse(structuredClone(this.state.calendar));
  }

  async createCategory(input: Parameters<CalendarRepository["createCategory"]>[0]) {
    const parsed = calendarCategoryWriteInputSchema.parse(input);
    this.assertUniqueCategoryName(parsed.name);
    this.state.calendar.categories = [...this.state.calendar.categories, {
      id: `calendar-category-${this.state.nextCalendarCategoryId++}`,
      ...parsed,
    }];
  }

  async updateCategory(categoryId: string, input: Parameters<CalendarRepository["updateCategory"]>[1]) {
    requireCategory(this.state.calendar.categories, categoryId);
    const parsed = calendarCategoryWriteInputSchema.parse(input);
    this.assertUniqueCategoryName(parsed.name, categoryId);
    this.state.calendar.categories = this.state.calendar.categories.map((category) => category.id === categoryId ? { ...category, ...parsed } : category);
  }

  async reorderCategories(categoryIds: string[]) {
    const parsed = calendarCategoryOrderSchema.parse(categoryIds);
    const currentIds = this.state.calendar.categories.map((category) => category.id);
    if (parsed.length !== currentIds.length || new Set(parsed).size !== currentIds.length || currentIds.some((id) => !parsed.includes(id))) {
      throw new Error("분류 순서에 현재 분류가 정확히 한 번씩 포함되어야 합니다.");
    }
    const categoriesById = new Map(this.state.calendar.categories.map((category) => [category.id, category]));
    this.state.calendar.categories = parsed.map((id) => categoriesById.get(id)!);
  }

  async deleteCategory(categoryId: string, replacementCategoryId: string) {
    requireCategory(this.state.calendar.categories, categoryId);
    requireCategory(this.state.calendar.categories, replacementCategoryId);
    if (categoryId === replacementCategoryId) throw new Error("삭제할 분류와 이동할 분류는 달라야 합니다.");
    if (this.state.calendar.categories.length === 1) throw new Error("마지막 분류는 삭제할 수 없습니다.");
    this.state.calendar.events = this.state.calendar.events.map((event) => event.categoryId === categoryId ? { ...event, categoryId: replacementCategoryId } : event);
    this.state.calendar.categories = this.state.calendar.categories.filter((category) => category.id !== categoryId);
  }

  async create(input: Parameters<CalendarRepository["create"]>[0]) {
    const parsed = calendarWriteInputSchema.parse(input);
    this.state.calendar.events = [{ id: `event-${this.state.nextCalendarId++}`, ...parsed }, ...this.state.calendar.events];
  }

  async update(eventId: string, input: Parameters<CalendarRepository["update"]>[1]) {
    requireEvent(this.state, eventId);
    const parsed = calendarWriteInputSchema.parse(input);
    this.state.calendar.events = this.state.calendar.events.map((event) => event.id === eventId ? { ...event, ...parsed } : event);
  }

  private assertUniqueCategoryName(name: string, exceptCategoryId?: string) {
    const normalized = name.toLocaleLowerCase("ko-KR");
    if (this.state.calendar.categories.some((category) => category.id !== exceptCategoryId && category.name.toLocaleLowerCase("ko-KR") === normalized)) {
      throw new Error("같은 이름의 분류가 이미 있습니다.");
    }
  }
}

export function createMockCalendarRepository(state = createMockPlatformState()): CalendarRepository {
  return new MockCalendarRepository(state);
}
