import { todoLabelOrderSchema, todoLabelWriteInputSchema, todoSnapshotSchema, todoWriteInputSchema, type TodoItem, type TodoLabel } from "@mono/contracts";
import type { TodoRepository } from "../../features/todo/todo-repository";
import { createMockPlatformState, type MockPlatformState } from "./mock-platform-state";
import { routineTodoItems, toggleRoutineOccurrence } from "./mock-routine-occurrences";

function requireItem(items: TodoItem[], itemId: string) {
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error(`할 일을 찾을 수 없습니다: ${itemId}`);
  return item;
}

function requireLabel(labels: TodoLabel[], labelId: string) {
  const label = labels.find((candidate) => candidate.id === labelId);
  if (!label) throw new Error(`라벨을 찾을 수 없습니다: ${labelId}`);
  return label;
}

class MockTodoRepository implements TodoRepository {
  constructor(private readonly state: MockPlatformState) {}

  async getSnapshot() {
    return todoSnapshotSchema.parse(structuredClone({
      ...this.state.todo,
      items: [...routineTodoItems(this.state), ...this.state.todo.items],
    }));
  }

  async createLabel(input: Parameters<TodoRepository["createLabel"]>[0]) {
    const parsed = todoLabelWriteInputSchema.parse(input);
    this.assertUniqueLabelName(parsed.name);
    const label = { id: `label-${this.state.nextTodoLabelId++}`, ...parsed };
    // "Other" is always left at the end.
    const fallbackIndex = this.state.todo.labels.findIndex((candidate) => candidate.id === "other");
    if (fallbackIndex < 0) this.state.todo.labels = [...this.state.todo.labels, label];
    else this.state.todo.labels = [...this.state.todo.labels.slice(0, fallbackIndex), label, ...this.state.todo.labels.slice(fallbackIndex)];
  }

  async updateLabel(labelId: string, input: Parameters<TodoRepository["updateLabel"]>[1]) {
    requireLabel(this.state.todo.labels, labelId);
    const parsed = todoLabelWriteInputSchema.parse(input);
    this.assertUniqueLabelName(parsed.name, labelId);
    this.state.todo.labels = this.state.todo.labels.map((label) => label.id === labelId ? { ...label, ...parsed } : label);
  }

  async reorderLabels(labelIds: string[]) {
    const parsed = todoLabelOrderSchema.parse(labelIds);
    const currentIds = this.state.todo.labels.map((label) => label.id);
    if (parsed.length !== currentIds.length || new Set(parsed).size !== currentIds.length || currentIds.some((id) => !parsed.includes(id))) {
      throw new Error("라벨 순서에 현재 라벨이 정확히 한 번씩 포함되어야 합니다.");
    }
    const labelsById = new Map(this.state.todo.labels.map((label) => [label.id, label]));
    this.state.todo.labels = parsed.map((id) => labelsById.get(id)!);
  }

  async deleteLabel(labelId: string, replacementLabelId: string) {
    requireLabel(this.state.todo.labels, labelId);
    if (labelId === "other") throw new Error("기타 라벨은 삭제할 수 없습니다.");
    requireLabel(this.state.todo.labels, replacementLabelId);
    if (labelId === replacementLabelId) throw new Error("삭제할 라벨과 이동할 라벨은 달라야 합니다.");
    if (this.state.todo.labels.length === 1) throw new Error("마지막 라벨은 삭제할 수 없습니다.");
    this.state.todo.items = this.state.todo.items.map((item) => item.labelId === labelId ? { ...item, labelId: replacementLabelId } : item);
    this.state.routine.items = this.state.routine.items.map((routine) => routine.labelId === labelId ? { ...routine, labelId: replacementLabelId } : routine);
    this.state.todo.labels = this.state.todo.labels.filter((label) => label.id !== labelId);
  }

  async create(input: Parameters<TodoRepository["create"]>[0]) {
    const parsed = todoWriteInputSchema.parse(input);
    const id = `task-${this.state.nextTodoId++}`;
    this.state.todo.items = [
      { id, ...parsed, done: false, completedAt: null, routineId: null, occurrenceDate: null, priority: 0 },
      ...this.state.todo.items,
    ];
  }

  async update(itemId: string, input: Parameters<TodoRepository["update"]>[1]) {
    requireItem(this.state.todo.items, itemId);
    const parsed = todoWriteInputSchema.parse(input);
    this.state.todo.items = this.state.todo.items.map((item) => item.id === itemId ? { ...item, ...parsed } : item);
  }

  async toggleComplete(itemId: string) {
    if (toggleRoutineOccurrence(this.state, itemId)) return;
    requireItem(this.state.todo.items, itemId);
    this.state.todo.items = this.state.todo.items.map((item) => item.id === itemId
      ? { ...item, done: !item.done, completedAt: item.done ? null : "방금" }
      : item);
  }

  async delete(itemId: string) {
    requireItem(this.state.todo.items, itemId);
    this.state.todo.items = this.state.todo.items.filter((item) => item.id !== itemId);
  }

  async setPriority(itemId: string, priority: number) {
    requireItem(this.state.todo.items, itemId);
    if (!Number.isInteger(priority) || priority < 0 || priority > 3) {
      throw new Error("우선순위는 0~3 사이여야 합니다.");
    }
    this.state.todo.items = this.state.todo.items.map((item) => item.id === itemId ? { ...item, priority } : item);
  }

  private assertUniqueLabelName(name: string, exceptLabelId?: string) {
    if (this.state.todo.labels.some((label) => label.id !== exceptLabelId && label.name.toLocaleLowerCase("ko-KR") === name.toLocaleLowerCase("ko-KR"))) {
      throw new Error("같은 이름의 라벨이 이미 있습니다.");
    }
  }
}

export function createMockTodoRepository(state = createMockPlatformState()): TodoRepository {
  return new MockTodoRepository(state);
}
