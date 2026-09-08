import { describe, expect, it } from "vitest";
import { createMockTodoRepository } from "./mock-todo-repository";
import { createMockPlatformState } from "./mock-platform-state";

async function itemsById(repository: ReturnType<typeof createMockTodoRepository>) {
  const snapshot = await repository.getSnapshot();
  return new Map(snapshot.items.map((item) => [item.id, item]));
}

describe("MockTodoRepository.reparent", () => {
  it("nests a top-level todo, dropping its own fields and adopting the parent's label", async () => {
    const state = createMockPlatformState();
    const repository = createMockTodoRepository(state);
    await repository.setPriority("task-3", 3);

    await repository.reparent("task-3", "task-1");

    const moved = (await itemsById(repository)).get("task-3")!;
    expect(moved.parentId).toBe("task-1");
    expect(moved.labelId).toBe("home"); // task-1's label
    expect(moved.dueDate).toBeNull();
    expect(moved.dueTime).toBeNull();
    expect(moved.note).toBe("");
    expect(moved.priority).toBe(0);
  });

  it("promotes a subtask back to top level", async () => {
    const repository = createMockTodoRepository(createMockPlatformState());
    await repository.reparent("task-4", "task-1");
    await repository.reparent("task-4", null);

    expect((await itemsById(repository)).get("task-4")!.parentId).toBeNull();
  });

  it("rejects nesting under a subtask, moving a parent, or dropping onto itself", async () => {
    const repository = createMockTodoRepository(createMockPlatformState());
    await repository.reparent("task-2", "task-1"); // task-2 is now a subtask of task-1

    await expect(repository.reparent("task-3", "task-2")).rejects.toThrow(/다시 하위 항목/);
    await expect(repository.reparent("task-1", "task-5")).rejects.toThrow(/하위 항목이 있는/);
    await expect(repository.reparent("task-5", "task-5")).rejects.toThrow(/자기 자신/);
  });

  it("rolls the new parent's completion up from the moved-in subtask", async () => {
    const repository = createMockTodoRepository(createMockPlatformState());
    // task-2 is done; moving it under task-5 (which has no other children) completes task-5.
    await repository.reparent("task-2", "task-5");

    expect((await itemsById(repository)).get("task-5")!.done).toBe(true);
  });
});
