import { randomUUID } from "node:crypto";
import {
  routineSnapshotSchema,
  routineWriteInputSchema,
  type RoutineOccurrence,
  type RoutineSnapshot,
  type RoutineWriteInput,
} from "@mono/contracts";
import { currentIsoDate } from "@mono/domain";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { routineItems, routineOccurrences, todoLabels } from "../db/schema.ts";

function occurrenceId(routineId: string, occurrenceDate: string) {
  return `routine-occurrence:${routineId}:${occurrenceDate}`;
}

function isRoutineScheduled(routine: { days: number[]; startDate: string; endDate: string | null }, date: string) {
  if (date < routine.startDate || (routine.endDate && date > routine.endDate)) return false;
  return routine.days.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
}

// 서버 Routine 저장소. 데스크톱 RoutineRepository 인터페이스와 같은 op·에러 시맨틱을 만족한다.
// occurrence는 결정 키(routineId + occurrenceDate)로 멱등 생성한다. Dashboard·Todo 화면이
// occurrence를 항목 단위로 완료 토글하려면 toggleOccurrenceById를 쓴다(공개 인터페이스 밖 확장).
export class SqliteRoutineRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async getSnapshot(): Promise<RoutineSnapshot> {
    const today = currentIsoDate();
    this.ensureTodayOccurrences(today);

    const labels = this.db.select().from(todoLabels).orderBy(asc(todoLabels.orderIndex)).all();
    const items = this.db.select().from(routineItems).orderBy(desc(routineItems.seq)).all();
    const occurrences = this.db.select().from(routineOccurrences).all();

    return routineSnapshotSchema.parse({
      today,
      labels: labels.map(({ orderIndex: _orderIndex, ...label }) => label),
      items: items.map(({ seq: _seq, daysJson, ...item }) => ({ ...item, days: JSON.parse(daysJson) })),
      occurrences,
    });
  }

  async create(input: RoutineWriteInput): Promise<void> {
    const parsed = routineWriteInputSchema.parse(input);
    const nextSeq = (this.db.select({ max: sql<number>`COALESCE(MAX(${routineItems.seq}), 0)` }).from(routineItems).get()?.max ?? 0) + 1;
    const days = [...parsed.days].sort((left, right) => left - right);
    this.db.insert(routineItems).values({
      id: randomUUID(),
      seq: nextSeq,
      title: parsed.title,
      labelId: parsed.labelId,
      daysJson: JSON.stringify(days),
      startDate: currentIsoDate(),
      endDate: parsed.endDate,
    }).run();
  }

  async update(routineId: string, input: RoutineWriteInput): Promise<void> {
    this.requireRoutine(routineId);
    const parsed = routineWriteInputSchema.parse(input);
    const days = [...parsed.days].sort((left, right) => left - right);
    this.db.update(routineItems).set({
      title: parsed.title,
      labelId: parsed.labelId,
      daysJson: JSON.stringify(days),
      endDate: parsed.endDate,
    }).where(eq(routineItems.id, routineId)).run();
  }

  async toggleToday(routineId: string): Promise<void> {
    const routine = this.requireRoutine(routineId);
    const today = currentIsoDate();
    const occurrence = this.ensureOccurrence(routine, today);
    if (!occurrence) throw new Error("오늘 실행하는 루틴이 아닙니다.");
    this.toggle(occurrence.id);
  }

  /** occurrence id로 직접 토글한다. 대상이 아니면 false. Dashboard·Todo read-model이 사용한다. */
  async toggleOccurrenceById(occurrenceId: string): Promise<boolean> {
    const occurrence = this.db.select().from(routineOccurrences).where(eq(routineOccurrences.id, occurrenceId)).get();
    if (!occurrence) return false;
    this.toggle(occurrenceId);
    return true;
  }

  private toggle(occurrenceId: string) {
    const occurrence = this.db.select().from(routineOccurrences).where(eq(routineOccurrences.id, occurrenceId)).get()!;
    const done = !occurrence.done;
    this.db.update(routineOccurrences).set({ done, completedAt: done ? new Date().toISOString() : null }).where(eq(routineOccurrences.id, occurrenceId)).run();
  }

  private ensureTodayOccurrences(today: string) {
    const items = this.db.select().from(routineItems).all();
    for (const item of items) {
      this.ensureOccurrence({ ...item, days: JSON.parse(item.daysJson) as number[] }, today);
    }
  }

  private ensureOccurrence(routine: { id: string; days: number[]; startDate: string; endDate: string | null }, date: string): RoutineOccurrence | null {
    if (!isRoutineScheduled(routine, date)) return null;
    const id = occurrenceId(routine.id, date);
    const existing = this.db.select().from(routineOccurrences).where(eq(routineOccurrences.id, id)).get();
    if (existing) return existing;
    const occurrence: RoutineOccurrence = { id, routineId: routine.id, occurrenceDate: date, done: false, completedAt: null };
    this.db.insert(routineOccurrences).values(occurrence).run();
    return occurrence;
  }

  private requireRoutine(routineId: string) {
    const routine = this.db.select().from(routineItems).where(eq(routineItems.id, routineId)).get();
    if (!routine) throw new Error(`루틴을 찾을 수 없습니다: ${routineId}`);
    return { ...routine, days: JSON.parse(routine.daysJson) as number[] };
  }
}
