import type { TodoLabelWriteInput, TodoSnapshot, TodoWriteInput } from "@mono/contracts";

export interface TodoLabelRepository {
  createLabel(input: TodoLabelWriteInput): Promise<void>;
  updateLabel(labelId: string, input: TodoLabelWriteInput, expectedVersion?: number): Promise<void>;
  reorderLabels(labelIds: string[]): Promise<void>;
  deleteLabel(labelId: string, replacementLabelId: string): Promise<void>;
}

export interface TodoRepository extends TodoLabelRepository {
  getSnapshot(): Promise<TodoSnapshot>;
  create(input: TodoWriteInput): Promise<void>;
  update(itemId: string, input: TodoWriteInput, expectedVersion?: number): Promise<void>;
  toggleComplete(itemId: string): Promise<void>;
  delete(itemId: string): Promise<void>;
}
