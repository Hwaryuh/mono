import type { TodoItem, TodoLabel } from "@mono/contracts";
import { currentIsoDate } from "@mono/domain";
import { Button, Icon, IconButton } from "@mono/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TodoRepository } from "../todo/todo-repository";
import {
  LocalStorageTimerSessionStore,
  sessionCountsByTodo,
  type TimerSession,
  type TimerSessionStore,
} from "./timer-session-store";

const FOCUS_MINUTES = 25;
const SHORT_BREAK_MINUTES = 5;
const LONG_BREAK_MINUTES = 15;
const LONG_BREAK_EVERY = 4;
const DAILY_GOAL = 8;
const TICK_MS = 250;

type Phase = "focus" | "shortBreak" | "longBreak";

const phaseMinutes: Record<Phase, number> = {
  focus: FOCUS_MINUTES,
  shortBreak: SHORT_BREAK_MINUTES,
  longBreak: LONG_BREAK_MINUTES,
};

function formatClock(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = String(Math.floor(safe / 60)).padStart(2, "0");
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

function startedAtOf(now: Date) {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function dueOrder(item: TodoItem) {
  return item.dueDate ?? "9999-12-31";
}

interface TimerPageProps {
  repository: TodoRepository;
  sessionStore?: TimerSessionStore;
}

export function TimerPage({ repository, sessionStore }: TimerPageProps) {
  const store = useMemo(
    () => sessionStore ?? LocalStorageTimerSessionStore.of(window.localStorage),
    [sessionStore],
  );
  const today = currentIsoDate();
  const snapshotQuery = useQuery({ queryKey: ["todo"], queryFn: () => repository.getSnapshot() });

  const [phase, setPhase] = useState<Phase>("focus");
  const [remaining, setRemaining] = useState(FOCUS_MINUTES * 60);
  // 실행 중이면 끝나는 시각(epoch ms). 남은 초를 매 틱 다시 계산해야 setInterval 오차가 쌓이지 않는다.
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [sessions, setSessions] = useState<TimerSession[]>(() => store.read(today));
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const selectedTodoIdRef = useRef<string | null>(null);

  const total = phaseMinutes[phase] * 60;
  const running = endsAt !== null;

  const labels = new Map<string, TodoLabel>((snapshotQuery.data?.labels ?? []).map((label) => [label.id, label]));
  const candidates = [...(snapshotQuery.data?.items ?? [])]
    .filter((item) => !item.done)
    .sort((first, second) => dueOrder(first).localeCompare(dueOrder(second)));
  const activeTodoId = selectedTodoId ?? candidates[0]?.id ?? null;
  selectedTodoIdRef.current = activeTodoId;

  const counts = sessionCountsByTodo(sessions);
  const focusedMinutes = sessions.reduce((sum, session) => sum + session.minutes, 0);
  const titles = new Map(candidates.map((item) => [item.id, item.title]));

  useEffect(() => {
    if (endsAt === null) return;
    const tick = () => {
      const left = Math.ceil((endsAt - Date.now()) / 1000);
      if (left > 0) {
        setRemaining(left);
        return;
      }
      setEndsAt(null);
      setRemaining(0);
      finishPhase(true);
    };
    const timer = window.setInterval(tick, TICK_MS);
    tick();
    return () => window.clearInterval(timer);
    // finishPhase 는 phase/sessions 를 함수형 갱신으로만 읽으므로 endsAt 만 의존한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt]);

  function finishPhase(record: boolean) {
    if (phase !== "focus") {
      setPhase("focus");
      setRemaining(FOCUS_MINUTES * 60);
      return;
    }
    const done = record
      ? store.append(today, {
        startedAt: startedAtOf(new Date(Date.now() - FOCUS_MINUTES * 60_000)),
        todoId: selectedTodoIdRef.current,
        minutes: FOCUS_MINUTES,
      })
      : sessions;
    if (record) setSessions(done);
    const nextPhase: Phase = done.length % LONG_BREAK_EVERY === 0 && done.length > 0 ? "longBreak" : "shortBreak";
    setPhase(nextPhase);
    setRemaining(phaseMinutes[nextPhase] * 60);
  }

  function toggle() {
    if (running) {
      setEndsAt(null);
      return;
    }
    setEndsAt(Date.now() + remaining * 1000);
  }

  function reset() {
    setEndsAt(null);
    setRemaining(total);
  }

  function skip() {
    setEndsAt(null);
    finishPhase(false);
  }

  const toggleLabel = running ? "일시정지" : remaining === total ? "시작" : "이어서";

  return (
    <div className="timer-page">
      <section className="timer-stage">
        <div className={`timer-digits ${phase === "focus" ? "" : "timer-digits--break"}`}>{formatClock(remaining)}</div>
        <div className="timer-bar">
          <span style={{ width: `${Math.round(((total - remaining) / total) * 100)}%` }} />
        </div>

        <div className="timer-tally">
          <span>오늘</span>
          <div className="timer-pips">
            {Array.from({ length: DAILY_GOAL }, (_, index) => (
              <i className={index < sessions.length ? "timer-pip timer-pip--done" : "timer-pip"} key={index} />
            ))}
          </div>
          <span className="timer-tally__count">{sessions.length} / {DAILY_GOAL}</span>
          {focusedMinutes > 0 && <span className="timer-tally__count">{Math.floor(focusedMinutes / 60)}시간 {focusedMinutes % 60}분</span>}
        </div>

        <div className="timer-controls">
          <Button onClick={toggle} variant="primary">
            <Icon name={running ? "pause" : "play"} size={15} strokeWidth={1.8} />
            {toggleLabel}
          </Button>
          <IconButton aria-label="세션 건너뛰기" onClick={skip} title="세션 건너뛰기" variant="secondary">
            <Icon name="skip" size={15} />
          </IconButton>
          <IconButton aria-label="타이머 되돌리기" onClick={reset} title="타이머 되돌리기" variant="secondary">
            <Icon name="sync" size={15} />
          </IconButton>
        </div>
      </section>

      <aside className="timer-side">
        <div className="timer-side__title">
          <span>할 일</span>
          <span>{candidates.length}</span>
        </div>

        <div className="timer-tasks">
          {candidates.map((item) => {
            const label = labels.get(item.labelId);
            const count = counts[item.id] ?? 0;
            return (
              <button
                aria-pressed={item.id === activeTodoId}
                className={item.id === activeTodoId ? "timer-task timer-task--active" : "timer-task"}
                key={item.id}
                onClick={() => setSelectedTodoId(item.id)}
                type="button"
              >
                <i style={{ background: label?.color ?? "var(--color-border-strong)" }} />
                <span className="timer-task__copy">
                  <strong>{item.title}</strong>
                  <span>
                    <span>{label?.name ?? "라벨 없음"}</span>
                    <span className="timer-task__count">{count === 0 ? "세션 없음" : `${count}세션`}</span>
                  </span>
                </span>
                {item.id === activeTodoId && <Icon name="clock" size={16} />}
              </button>
            );
          })}
          {candidates.length === 0 && (
            <div className="timer-tasks__empty">
              <Icon name="todo" size={22} strokeWidth={1.4} />
              <span>남은 할 일이 없습니다</span>
            </div>
          )}
        </div>

        <div className="timer-log">
          <div className="timer-side__title">기록</div>
          {sessions.length === 0 && <p className="timer-log__empty">아직 마친 세션이 없습니다.</p>}
          {sessions.map((session, index) => (
            <div className="timer-log__row" key={`${session.startedAt}-${index}`}>
              <span className="timer-log__time">{session.startedAt}</span>
              <span className="timer-log__title">{session.todoId ? titles.get(session.todoId) ?? "삭제된 할 일" : "할 일 없음"}</span>
              <span className="timer-log__minutes">{session.minutes}분</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
