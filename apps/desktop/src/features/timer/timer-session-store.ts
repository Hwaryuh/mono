export const TIMER_SESSIONS_STORAGE_KEY = "mono:timer-sessions";

export type TimerSession = {
  /** 세션을 시작한 시각. "HH:MM" */
  startedAt: string;
  todoId: string | null;
  minutes: number;
};

export interface TimerSessionStore {
  read(date: string): TimerSession[];
  append(date: string, session: TimerSession): TimerSession[];
}

type StoredLog = { date: string; sessions: TimerSession[] };

function isSession(value: unknown): value is TimerSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<TimerSession>;
  return typeof session.startedAt === "string"
    && typeof session.minutes === "number"
    && (session.todoId === null || typeof session.todoId === "string");
}

function parseLog(raw: string | null): StoredLog | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const log = parsed as Partial<StoredLog>;
    if (typeof log.date !== "string" || !Array.isArray(log.sessions)) return null;
    return { date: log.date, sessions: log.sessions.filter(isSession) };
  } catch {
    return null;
  }
}

/** ponytail: 오늘 하루치만 남긴다. 날짜가 바뀌면 이전 기록은 버린다 —
 *  기간별 통계가 필요해지면 그때 서버(세션 엔티티)로 올린다. */
export class LocalStorageTimerSessionStore implements TimerSessionStore {
  private constructor(private readonly storage: Storage) {}

  static of(storage: Storage): LocalStorageTimerSessionStore {
    return new LocalStorageTimerSessionStore(storage);
  }

  read(date: string): TimerSession[] {
    try {
      const log = parseLog(this.storage.getItem(TIMER_SESSIONS_STORAGE_KEY));
      return log && log.date === date ? log.sessions : [];
    } catch {
      return [];
    }
  }

  append(date: string, session: TimerSession): TimerSession[] {
    const sessions = [...this.read(date), session];
    try {
      this.storage.setItem(TIMER_SESSIONS_STORAGE_KEY, JSON.stringify({ date, sessions } satisfies StoredLog));
    } catch {
      // 저장소가 막혀도 이번 세션의 화면 기록은 유지한다.
    }
    return sessions;
  }
}

export class InMemoryTimerSessionStore implements TimerSessionStore {
  private log: StoredLog = { date: "", sessions: [] };

  read(date: string): TimerSession[] {
    return this.log.date === date ? this.log.sessions : [];
  }

  append(date: string, session: TimerSession): TimerSession[] {
    this.log = { date, sessions: [...this.read(date), session] };
    return this.log.sessions;
  }
}

export function sessionCountsByTodo(sessions: TimerSession[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const session of sessions) {
    if (!session.todoId) continue;
    counts[session.todoId] = (counts[session.todoId] ?? 0) + 1;
  }
  return counts;
}
