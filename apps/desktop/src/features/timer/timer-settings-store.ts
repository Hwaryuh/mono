export const TIMER_SETTINGS_STORAGE_KEY = "mono:timer-settings";
/** No storage event fires because the settings modal and timer page are in the same window. This event notifies after saving instead. */
export const TIMER_SETTINGS_EVENT = "mono:timer-settings-changed";

export type TimerTodoScope = "all" | "today";

export type TimerSettings = {
  focusMinutes: number;
  todoScope: TimerTodoScope;
  alarmEnabled: boolean;
};

export const defaultTimerSettings: TimerSettings = {
  focusMinutes: 25,
  todoScope: "all",
  alarmEnabled: true,
};

export const timerMinuteBounds = { min: 1, max: 180 } as const;

function clamp(value: unknown, fallback: number, bounds: { min: number; max: number }): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(numeric)));
}

export function normalizeTimerSettings(value: unknown): TimerSettings {
  if (!value || typeof value !== "object") return defaultTimerSettings;
  const raw = value as Partial<TimerSettings>;
  return {
    focusMinutes: clamp(raw.focusMinutes, defaultTimerSettings.focusMinutes, timerMinuteBounds),
    todoScope: raw.todoScope === "today" ? "today" : "all",
    alarmEnabled: typeof raw.alarmEnabled === "boolean" ? raw.alarmEnabled : defaultTimerSettings.alarmEnabled,
  };
}

export interface TimerSettingsStore {
  read(): TimerSettings;
  write(settings: TimerSettings): void;
}

export class LocalStorageTimerSettingsStore implements TimerSettingsStore {
  private constructor(private readonly storage: Storage) {}

  static of(storage: Storage): LocalStorageTimerSettingsStore {
    return new LocalStorageTimerSettingsStore(storage);
  }

  read(): TimerSettings {
    try {
      const raw = this.storage.getItem(TIMER_SETTINGS_STORAGE_KEY);
      return raw ? normalizeTimerSettings(JSON.parse(raw)) : defaultTimerSettings;
    } catch {
      return defaultTimerSettings;
    }
  }

  write(settings: TimerSettings): void {
    const normalized = normalizeTimerSettings(settings);
    try {
      this.storage.setItem(TIMER_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Even if storage is blocked, this session's setting change is kept.
    }
  }
}

export class InMemoryTimerSettingsStore implements TimerSettingsStore {
  private settings: TimerSettings = defaultTimerSettings;

  read(): TimerSettings {
    return this.settings;
  }

  write(settings: TimerSettings): void {
    this.settings = normalizeTimerSettings(settings);
  }
}
