export const TIMER_SETTINGS_STORAGE_KEY = "mono:timer-settings";
/** 설정 모달과 타이머 페이지가 같은 창에 있으므로 storage 이벤트가 안 온다. 저장 후 이 이벤트로 알린다. */
export const TIMER_SETTINGS_EVENT = "mono:timer-settings-changed";

export type TimerTodoScope = "all" | "today";

export type TimerSettings = {
  focusMinutes: number;
  shortBreakMinutes: number;
  autoStartBreak: boolean;
  autoStartFocus: boolean;
  todoScope: TimerTodoScope;
};

export const defaultTimerSettings: TimerSettings = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  autoStartBreak: true,
  autoStartFocus: false,
  todoScope: "all",
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
    shortBreakMinutes: clamp(raw.shortBreakMinutes, defaultTimerSettings.shortBreakMinutes, timerMinuteBounds),
    autoStartBreak: typeof raw.autoStartBreak === "boolean" ? raw.autoStartBreak : defaultTimerSettings.autoStartBreak,
    autoStartFocus: typeof raw.autoStartFocus === "boolean" ? raw.autoStartFocus : defaultTimerSettings.autoStartFocus,
    todoScope: raw.todoScope === "today" ? "today" : "all",
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
      // 저장소가 막혀도 이번 세션의 설정 변경은 유지한다.
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
