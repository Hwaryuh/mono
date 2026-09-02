import { describe, expect, it } from "vitest";
import {
  LocalStorageTimerSessionStore,
  sessionCountsByTodo,
  TIMER_SESSIONS_STORAGE_KEY,
} from "./timer-session-store";

function storageOf(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
}

describe("LocalStorageTimerSessionStore", () => {
  it("어제 기록은 오늘 읽을 때 버린다", () => {
    const storage = storageOf({
      [TIMER_SESSIONS_STORAGE_KEY]: JSON.stringify({
        date: "2026-09-01",
        sessions: [{ startedAt: "09:20", todoId: "t1", minutes: 25 }],
      }),
    });

    expect(LocalStorageTimerSessionStore.of(storage).read("2026-09-02")).toEqual([]);
  });

  it("같은 날 세션은 쌓인다", () => {
    const store = LocalStorageTimerSessionStore.of(storageOf());
    store.append("2026-09-02", { startedAt: "09:20", todoId: "t1", minutes: 25 });
    const sessions = store.append("2026-09-02", { startedAt: "09:55", todoId: "t2", minutes: 25 });

    expect(sessions).toHaveLength(2);
    expect(store.read("2026-09-02")).toHaveLength(2);
  });

  it("깨진 저장값은 빈 기록으로 읽는다", () => {
    const storage = storageOf({ [TIMER_SESSIONS_STORAGE_KEY]: "{not json" });

    expect(LocalStorageTimerSessionStore.of(storage).read("2026-09-02")).toEqual([]);
  });

  it("할 일별 세션 수를 센다", () => {
    const counts = sessionCountsByTodo([
      { startedAt: "09:20", todoId: "t1", minutes: 25 },
      { startedAt: "09:55", todoId: "t1", minutes: 25 },
      { startedAt: "11:10", todoId: null, minutes: 25 },
    ]);

    expect(counts).toEqual({ t1: 2 });
  });
});
