import { randomUUID } from "node:crypto";
import {
  calendarCategoryOrderSchema,
  calendarCategoryWriteInputSchema,
  calendarSnapshotSchema,
  calendarWriteInputSchema,
  type CalendarCategoryWriteInput,
  type CalendarSnapshot,
  type CalendarWriteInput,
} from "@mono/contracts";
import { currentIsoDate } from "@mono/domain";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { calendarCategories, calendarEvents } from "../db/schema.ts";

// 서버 Calendar 저장소. 데스크톱 CalendarRepository 인터페이스와 같은 op·에러 시맨틱을 만족한다.
export class SqliteCalendarRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async getSnapshot(): Promise<CalendarSnapshot> {
    const categories = this.db.select().from(calendarCategories).orderBy(asc(calendarCategories.orderIndex)).all();
    const events = this.db.select().from(calendarEvents).orderBy(desc(calendarEvents.seq)).all();
    return calendarSnapshotSchema.parse({
      today: currentIsoDate(),
      categories: categories.map(({ orderIndex: _orderIndex, ...category }) => category),
      events: events.map(({ seq: _seq, ...event }) => event),
    });
  }

  async createCategory(input: CalendarCategoryWriteInput): Promise<void> {
    const parsed = calendarCategoryWriteInputSchema.parse(input);
    this.assertUniqueName(parsed.name);
    const nextOrder = (this.db.select({ max: sql<number>`COALESCE(MAX(${calendarCategories.orderIndex}), -1)` }).from(calendarCategories).get()?.max ?? -1) + 1;
    this.db.insert(calendarCategories).values({ id: randomUUID(), name: parsed.name, color: parsed.color, orderIndex: nextOrder }).run();
  }

  async updateCategory(categoryId: string, input: CalendarCategoryWriteInput): Promise<void> {
    this.requireCategory(categoryId);
    const parsed = calendarCategoryWriteInputSchema.parse(input);
    this.assertUniqueName(parsed.name, categoryId);
    this.db.update(calendarCategories).set({ name: parsed.name, color: parsed.color }).where(eq(calendarCategories.id, categoryId)).run();
  }

  async reorderCategories(categoryIds: string[]): Promise<void> {
    const parsed = calendarCategoryOrderSchema.parse(categoryIds);
    const currentIds = this.db.select({ id: calendarCategories.id }).from(calendarCategories).all().map((row) => row.id);
    if (parsed.length !== currentIds.length || new Set(parsed).size !== currentIds.length || currentIds.some((id) => !parsed.includes(id))) {
      throw new Error("분류 순서에 현재 분류가 정확히 한 번씩 포함되어야 합니다.");
    }
    this.db.transaction((tx) => {
      parsed.forEach((id, index) => tx.update(calendarCategories).set({ orderIndex: index }).where(eq(calendarCategories.id, id)).run());
    });
  }

  async deleteCategory(categoryId: string, replacementCategoryId: string): Promise<void> {
    this.requireCategory(categoryId);
    this.requireCategory(replacementCategoryId);
    if (categoryId === replacementCategoryId) throw new Error("삭제할 분류와 이동할 분류는 달라야 합니다.");
    const count = this.db.select({ n: sql<number>`COUNT(*)` }).from(calendarCategories).get()?.n ?? 0;
    if (count === 1) throw new Error("마지막 분류는 삭제할 수 없습니다.");
    this.db.transaction((tx) => {
      tx.update(calendarEvents).set({ categoryId: replacementCategoryId }).where(eq(calendarEvents.categoryId, categoryId)).run();
      tx.delete(calendarCategories).where(eq(calendarCategories.id, categoryId)).run();
    });
  }

  async create(input: CalendarWriteInput): Promise<void> {
    const parsed = calendarWriteInputSchema.parse(input);
    const nextSeq = (this.db.select({ max: sql<number>`COALESCE(MAX(${calendarEvents.seq}), 0)` }).from(calendarEvents).get()?.max ?? 0) + 1;
    this.db.insert(calendarEvents).values({ id: randomUUID(), seq: nextSeq, ...parsed }).run();
  }

  async update(eventId: string, input: CalendarWriteInput): Promise<void> {
    this.requireEvent(eventId);
    const parsed = calendarWriteInputSchema.parse(input);
    this.db.update(calendarEvents).set(parsed).where(eq(calendarEvents.id, eventId)).run();
  }

  private requireEvent(eventId: string) {
    const event = this.db.select().from(calendarEvents).where(eq(calendarEvents.id, eventId)).get();
    if (!event) throw new Error(`일정을 찾을 수 없습니다: ${eventId}`);
    return event;
  }

  private requireCategory(categoryId: string) {
    const category = this.db.select().from(calendarCategories).where(eq(calendarCategories.id, categoryId)).get();
    if (!category) throw new Error(`일정 라벨을 찾을 수 없습니다: ${categoryId}`);
    return category;
  }

  private assertUniqueName(name: string, exceptCategoryId?: string) {
    const clash = this.db.select().from(calendarCategories).all().some((category) =>
      category.id !== exceptCategoryId && category.name.toLocaleLowerCase("ko-KR") === name.toLocaleLowerCase("ko-KR"));
    if (clash) throw new Error("같은 이름의 분류가 이미 있습니다.");
  }
}
