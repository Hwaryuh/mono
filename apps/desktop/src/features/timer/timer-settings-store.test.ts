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
    expect(normalizeTimerSettings({ focusSeconds: 999_999 }).focusSeconds).toBe(180 * 60);
    expect(normalizeTimerSettings({ focusSeconds: 0 }).focusSeconds).toBe(1);
  });

  it("migrates a legacy focusMinutes value to seconds", () => {
    expect(normalizeTimerSettings({ focusMinutes: 25 }).focusSeconds).toBe(1500);
  });

  it("discards the legacy rest setting", () => {
    const settings = normalizeTimerSettings({ shortBreakMinutes: 5, autoStartBreak: true, autoStartFocus: true });

    expect(settings).not.toHaveProperty("shortBreakMinutes");
    expect(settings).not.toHaveProperty("autoStartBreak");
    expect(settings).not.toHaveProperty("autoStartFocus");
  });

  it("fills in missing or corrupted values with defaults", () => {
    expect(normalizeTimerSettings({ focusSeconds: "몰라" })).toEqual(defaultTimerSettings);
    expect(normalizeTimerSettings(null)).toEqual(defaultTimerSettings);
  });

  it("reads back a saved value", () => {
    const storage = storageOf();
    const store = LocalStorageTimerSettingsStore.of(storage);
    store.write({ ...defaultTimerSettings, focusSeconds: 50 * 60 + 30, alarmEnabled: false });

    expect(store.read()).toMatchObject({ focusSeconds: 3030, alarmEnabled: false });
  });

  it("reads a corrupted stored value as the default", () => {
    const storage = storageOf({ [TIMER_SETTINGS_STORAGE_KEY]: "{not json" });

    expect(LocalStorageTimerSettingsStore.of(storage).read()).toEqual(defaultTimerSettings);
  });
});
