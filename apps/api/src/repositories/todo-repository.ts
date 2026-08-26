import { randomUUID } from "node:crypto";
import {
  todoLabelOrderSchema,
  todoLabelWriteInputSchema,
  todoSnapshotSchema,
  todoWriteInputSchema,
  type TodoLabelWriteInput,
  type TodoSnapshot,
  type TodoWriteInput,
} from "@mono/contracts";
import { currentIsoDate } from "@mono/domain";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { todoItems, todoLabels } from "../db/schema.ts";

// 서버 Todo 저장소. 데스크톱 TodoRepository 인터페이스와 같은 op·에러 시맨틱을 만족한다.
// 루틴 occurrence 병합(mock getSnapshot의 routineTodoItems)은 Routine 경계가 영속화될 때
// read-model join으로 붙인다. 여기서는 Todo 자체 데이터만 다룬다.
export class SqliteTodoRepository {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async getSnapshot(): Promise<TodoSnapshot> {
    const labels = this.db.select().from(todoLabels).orderBy(asc(todoLabels.orderIndex)).all();
    const items = this.db.select().from(todoItems).orderBy(desc(todoItems.seq)).all();
    return todoSnapshotSchema.parse({
      today: currentIsoDate(),
      labels: labels.map(({ orderIndex: _orderIndex, ...label }) => label),
      items: items.map(({ seq: _seq, ...item }) => item),
    });
  }

  async createLabel(input: TodoLabelWriteInput): Promise<void> {
    const parsed = todoLabelWriteInputSchema.parse(input);
    this.assertUniqueLabelName(parsed.name);
    const nextOrder = (this.db.select({ max: sql<number>`COALESCE(MAX(${todoLabels.orderIndex}), -1)` }).from(todoLabels).get()?.max ?? -1) + 1;
    this.db.insert(todoLabels).values({ id: randomUUID(), name: parsed.name, color: parsed.color, orderIndex: nextOrder }).run();
  }

  async updateLabel(labelId: string, input: TodoLabelWriteInput): Promise<void> {
    this.requireLabel(labelId);
    const parsed = todoLabelWriteInputSchema.parse(input);
    this.assertUniqueLabelName(parsed.name, labelId);
    this.db.update(todoLabels).set({ name: parsed.name, color: parsed.color }).where(eq(todoLabels.id, labelId)).run();
  }

  async reorderLabels(labelIds: string[]): Promise<void> {
    const parsed = todoLabelOrderSchema.parse(labelIds);
    const currentIds = this.db.select({ id: todoLabels.id }).from(todoLabels).all().map((row) => row.id);
    if (parsed.length !== currentIds.length || new Set(parsed).size !== currentIds.length || currentIds.some((id) => !parsed.includes(id))) {
      throw new Error("라벨 순서에 현재 라벨이 정확히 한 번씩 포함되어야 합니다.");
    }
    this.db.transaction((tx) => {
      parsed.forEach((id, index) => tx.update(todoLabels).set({ orderIndex: index }).where(eq(todoLabels.id, id)).run());
    });
  }

  async deleteLabel(labelId: string, replacementLabelId: string): Promise<void> {
    this.requireLabel(labelId);
    this.requireLabel(replacementLabelId);
    if (labelId === replacementLabelId) throw new Error("삭제할 라벨과 이동할 라벨은 달라야 합니다.");
    const count = this.db.select({ n: sql<number>`COUNT(*)` }).from(todoLabels).get()?.n ?? 0;
    if (count === 1) throw new Error("마지막 라벨은 삭제할 수 없습니다.");
    this.db.transaction((tx) => {
      tx.update(todoItems).set({ labelId: replacementLabelId }).where(eq(todoItems.labelId, labelId)).run();
      tx.delete(todoLabels).where(eq(todoLabels.id, labelId)).run();
    });
  }

  async create(input: TodoWriteInput): Promise<void> {
    const parsed = todoWriteInputSchema.parse(input);
    const nextSeq = (this.db.select({ max: sql<number>`COALESCE(MAX(${todoItems.seq}), 0)` }).from(todoItems).get()?.max ?? 0) + 1;
    this.db.insert(todoItems).values({
      id: randomUUID(),
      seq: nextSeq,
      title: parsed.title,
      labelId: parsed.labelId,
      dueDate: parsed.dueDate,
      dueTime: parsed.dueTime,
      note: parsed.note,
      done: false,
      completedAt: null,
      routineId: null,
      occurrenceDate: null,
    }).run();
  }

  async update(itemId: string, input: TodoWriteInput): Promise<void> {
    this.requireItem(itemId);
    const parsed = todoWriteInputSchema.parse(input);
    this.db.update(todoItems).set({
      title: parsed.title,
      labelId: parsed.labelId,
      dueDate: parsed.dueDate,
      dueTime: parsed.dueTime,
      note: parsed.note,
    }).where(eq(todoItems.id, itemId)).run();
  }

  async toggleComplete(itemId: string): Promise<void> {
    const item = this.requireItem(itemId);
    const done = !item.done;
    this.db.update(todoItems).set({ done, completedAt: done ? new Date().toISOString() : null }).where(eq(todoItems.id, itemId)).run();
  }

  async delete(itemId: string): Promise<void> {
    this.requireItem(itemId);
    this.db.delete(todoItems).where(eq(todoItems.id, itemId)).run();
  }

  private requireLabel(labelId: string) {
    const label = this.db.select().from(todoLabels).where(eq(todoLabels.id, labelId)).get();
    if (!label) throw new Error(`라벨을 찾을 수 없습니다: ${labelId}`);
    return label;
  }

  private requireItem(itemId: string) {
    const item = this.db.select().from(todoItems).where(eq(todoItems.id, itemId)).get();
    if (!item) throw new Error(`할 일을 찾을 수 없습니다: ${itemId}`);
    return item;
  }

  private assertUniqueLabelName(name: string, exceptLabelId?: string) {
    const clash = this.db.select().from(todoLabels).all().some((label) =>
      label.id !== exceptLabelId && label.name.toLocaleLowerCase("ko-KR") === name.toLocaleLowerCase("ko-KR"));
    if (clash) throw new Error("같은 이름의 라벨이 이미 있습니다.");
  }
}
