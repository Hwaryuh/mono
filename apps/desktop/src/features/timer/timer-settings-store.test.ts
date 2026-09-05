import { describe, expect, it } from "vitest";
import {
  defaultTimerSettings,
  LocalStorageTimerSettingsStore,
  normalizeTimerSettings,
  TIMER_SETTINGS_STORAGE_KEY,
} from "./timer-settings-store";

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

describe("timer settings", () => {
  it("clamps an out-of-range value to the boundary", () => {
    expect(normalizeTimerSettings({ focusMinutes: 999 }).focusMinutes).toBe(180);
    expect(normalizeTimerSettings({ focusMinutes: 0 }).focusMinutes).toBe(1);
  });

  it("discards the legacy rest setting", () => {
    const settings = normalizeTimerSettings({ shortBreakMinutes: 5, autoStartBreak: true, autoStartFocus: true });

    expect(settings).not.toHaveProperty("shortBreakMinutes");
    expect(settings).not.toHaveProperty("autoStartBreak");
    expect(settings).not.toHaveProperty("autoStartFocus");
  });

  it("fills in missing or corrupted values with defaults", () => {
    expect(normalizeTimerSettings({ focusMinutes: "몰라" })).toEqual(defaultTimerSettings);
    expect(normalizeTimerSettings(null)).toEqual(defaultTimerSettings);
  });

  it("reads back a saved value", () => {
    const storage = storageOf();
    const store = LocalStorageTimerSettingsStore.of(storage);
    store.write({ ...defaultTimerSettings, focusMinutes: 50, alarmEnabled: false, todoScope: "today" });

    expect(store.read()).toMatchObject({ focusMinutes: 50, alarmEnabled: false, todoScope: "today" });
  });

  it("reads a corrupted stored value as the default", () => {
    const storage = storageOf({ [TIMER_SETTINGS_STORAGE_KEY]: "{not json" });

    expect(LocalStorageTimerSettingsStore.of(storage).read()).toEqual(defaultTimerSettings);
  });
});
