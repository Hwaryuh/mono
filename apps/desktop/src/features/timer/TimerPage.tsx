import { translate } from "../../i18n/i18n";
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
import {
  LocalStorageTimerSettingsStore,
  normalizeTimerSettings,
  TIMER_SETTINGS_EVENT,
  type TimerSettings,
  type TimerSettingsStore,
} from "./timer-settings-store";
import { createAlarm, type Alarm } from "./timer-alarm";
import { focusAppWindow, notifySessionEnd, onNotificationClick } from "./timer-notify";

const DAILY_GOAL = 8;
const TICK_MS = 250;

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
  settingsStore?: TimerSettingsStore;
  alarm?: Alarm;
}

export function TimerPage({ repository, sessionStore, settingsStore, alarm: alarmProp }: TimerPageProps) {
  const store = useMemo(
    () => sessionStore ?? LocalStorageTimerSessionStore.of(window.localStorage),
    [sessionStore],
  );
  const preferences = useMemo(
    () => settingsStore ?? LocalStorageTimerSettingsStore.of(window.localStorage),
    [settingsStore],
  );
  const alarm = useMemo(() => alarmProp ?? createAlarm(), [alarmProp]);
  const today = currentIsoDate();
  const snapshotQuery = useQuery({ queryKey: ["todo"], queryFn: () => repository.getSnapshot() });

  const [settings, setSettings] = useState<TimerSettings>(() => preferences.read());
  const [remaining, setRemaining] = useState(() => preferences.read().focusMinutes * 60);
  // 실행 중이면 끝나는 시각(epoch ms). 남은 초를 매 틱 다시 계산해야 setInterval 오차가 쌓이지 않는다.
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [sessions, setSessions] = useState<TimerSession[]>(() => store.read(today));
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const selectedTodoIdRef = useRef<string | null>(null);
  // 방금 집중이 끝나 울리고 있는지. 끄기 전까지 다음 세션으로 넘어가지 않는다.
  const [ringing, setRinging] = useState(false);
  // 큰 숫자를 눌러 길이를 고치는 중인지. 입력값은 커밋(blur·Enter) 때만 숫자로 좁힌다.
  const [editingMinutes, setEditingMinutes] = useState(false);
  const [minutesDraft, setMinutesDraft] = useState<string | null>(null);

  const total = settings.focusMinutes * 60;
  const running = endsAt !== null;
  // 카운트다운 중도, 울리는 중도 아닐 때만 길이를 고칠 수 있다(시작 전·일시정지 포함).
  const canEditMinutes = !running && !ringing;

  const labels = new Map<string, TodoLabel>((snapshotQuery.data?.labels ?? []).map((label) => [label.id, label]));
  const candidates = [...(snapshotQuery.data?.items ?? [])]
    .filter((item) => !item.done)
    .filter((item) => settings.todoScope === "all" || (item.dueDate !== null && item.dueDate <= today))
    .sort((first, second) => dueOrder(first).localeCompare(dueOrder(second)));
  const activeTodoId = selectedTodoId ?? candidates[0]?.id ?? null;
  selectedTodoIdRef.current = activeTodoId;

  const counts = sessionCountsByTodo(sessions);
  const focusedMinutes = sessions.reduce((sum, session) => sum + session.minutes, 0);
  const titles = new Map(candidates.map((item) => [item.id, item.title]));

  useEffect(() => {
    if (endsAt === null) return;
    // setEndsAt(null) 만으로는 이 effect 가 정리되기 전에 다음 틱이 또 돌아 세션이 여러 번 기록된다.
    // 끝나는 순간 이 interval 을 직접 멈추고 플래그로 재진입을 막는다.
    let finished = false;
    const tick = () => {
      if (finished) return;
      const left = Math.ceil((endsAt - Date.now()) / 1000);
      if (left > 0) {
        setRemaining(left);
        return;
      }
      finished = true;
      window.clearInterval(timer);
      setEndsAt(null);
      setRemaining(0);
      finishFocus(true);
    };
    const timer = window.setInterval(tick, TICK_MS);
    tick();
    return () => window.clearInterval(timer);
    // finishFocus 는 렌더마다 새로 만들어지므로 의존성에 넣지 않는다 — 값은 settings 로 들어온다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt, settings]);

  // 설정 모달은 같은 창에 있어서 storage 이벤트가 오지 않는다. 저장 시 발행되는 이벤트를 듣는다.
  useEffect(() => {
    const reload = () => {
      const next = preferences.read();
      setSettings(next);
      // 돌고 있는 세션은 건드리지 않는다. 멈춰 있을 때만 새 길이로 맞춘다.
      setEndsAt((current) => {
        if (current === null) setRemaining(next.focusMinutes * 60);
        return current;
      });
    };
    window.addEventListener(TIMER_SETTINGS_EVENT, reload);
    return () => window.removeEventListener(TIMER_SETTINGS_EVENT, reload);
  }, [preferences]);

  // 페이지를 벗어나면 울리던 알람을 멈춘다.
  useEffect(() => () => alarm.stop(), [alarm]);

  // 알림 배너를 클릭하면 앱 창을 앞으로 가져온다.
  useEffect(() => {
    let disposed = false;
    let dispose = () => {};
    void onNotificationClick(() => void focusAppWindow()).then((off) => {
      if (disposed) off();
      else dispose = off;
    });
    return () => {
      disposed = true;
      dispose();
    };
  }, []);

  function resetToFocus() {
    setRemaining(settings.focusMinutes * 60);
    setEndsAt(null);
  }

  function finishFocus(record: boolean) {
    if (record) {
      setSessions(store.append(today, {
        startedAt: startedAtOf(new Date(Date.now() - settings.focusMinutes * 60_000)),
        todoId: selectedTodoIdRef.current,
        minutes: settings.focusMinutes,
      }));
      if (settings.alarmEnabled) {
        alarm.start();
        void notifySessionEnd(translate("timer.notify.focusTitle"), translate("timer.notify.body"));
        setRinging(true);
        return;
      }
    }
    resetToFocus();
  }

  function dismissAlarm() {
    alarm.stop();
    setRinging(false);
    resetToFocus();
  }

  function commitMinutesDraft() {
    const raw = minutesDraft;
    setMinutesDraft(null);
    setEditingMinutes(false);
    if (raw === null || raw.trim() === "") return;
    const next = normalizeTimerSettings({ ...settings, focusMinutes: Number(raw) });
    setSettings(next);
    preferences.write(next);
    setRemaining(next.focusMinutes * 60);
  }

  function toggle() {
    if (ringing) {
      dismissAlarm();
      return;
    }
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
    finishFocus(false);
  }

  const toggleLabel = running ? translate("timer.action.pause") : remaining === total ? translate("timer.action.start") : translate("timer.action.resume");
  const currentMinutes = settings.focusMinutes;

  return (
    <div className="timer-page">
      <section className="timer-stage">
        <div className={`timer-digits ${ringing ? "timer-digits--ringing" : ""}`}>
          {editingMinutes && canEditMinutes ? (
            <input
              aria-label={translate("timer.adjust.label")}
              autoFocus
              className="timer-digits__input"
              inputMode="numeric"
              max={180}
              min={1}
              onBlur={commitMinutesDraft}
              onChange={(event) => setMinutesDraft(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setMinutesDraft(null);
                  setEditingMinutes(false);
                }
              }}
              type="number"
              value={minutesDraft ?? String(currentMinutes)}
            />
          ) : canEditMinutes ? (
            <button
              className="timer-digits__edit"
              onClick={() => setEditingMinutes(true)}
              title={translate("timer.adjust.edit")}
              type="button"
            >
              {formatClock(remaining)}
            </button>
          ) : (
            formatClock(remaining)
          )}
        </div>
        <div className="timer-bar" hidden={editingMinutes && canEditMinutes}>
          <span style={{ width: `${Math.round(((total - remaining) / total) * 100)}%` }} />
        </div>
        <span className="timer-phase">{translate("timer.phase.focus")}</span>

        <div className="timer-tally">
          <span>{translate("todo.filter.today")}</span>
          <div className="timer-pips">
            {Array.from({ length: DAILY_GOAL }, (_, index) => (
              <i className={index < sessions.length ? "timer-pip timer-pip--done" : "timer-pip"} key={index} />
            ))}
          </div>
          <span className="timer-tally__count">{sessions.length} / {DAILY_GOAL}</span>
          {focusedMinutes > 0 && <span className="timer-tally__count">{translate("timer.duration.hoursMinutes", { hours: Math.floor(focusedMinutes / 60), minutes: focusedMinutes % 60 })}</span>}
        </div>

        <div className="timer-controls">
          {ringing ? (
            <Button onClick={dismissAlarm} variant="primary">
              <Icon name="bell" size={15} strokeWidth={1.8} />
              {translate("timer.action.stopAlarm")}
            </Button>
          ) : (
            <>
              <Button onClick={toggle} variant="primary">
                <Icon name={running ? "pause" : "play"} size={15} strokeWidth={1.8} />
                {toggleLabel}
              </Button>
              <IconButton aria-label={translate("timer.action.skipSession")} onClick={skip} title={translate("timer.action.skipSession")} variant="secondary">
                <Icon name="skip" size={15} />
              </IconButton>
              <IconButton aria-label={translate("timer.action.reset")} onClick={reset} title={translate("timer.action.reset")} variant="secondary">
                <Icon name="sync" size={15} />
              </IconButton>
            </>
          )}
        </div>
      </section>

      <aside className="timer-side">
        <div className="timer-side__title">
          <span>{translate("app.navigation.todo")}</span>
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
                    <span>{label?.name ?? translate("timer.todo.noLabel")}</span>
                    <span className="timer-task__count">{count === 0 ? translate("timer.todo.noSessions") : translate("timer.todo.sessionCount", { count })}</span>
                  </span>
                </span>
                {item.id === activeTodoId && <Icon name="clock" size={16} />}
              </button>
            );
          })}
          {candidates.length === 0 && (
            <div className="timer-tasks__empty">
              <Icon name="todo" size={22} strokeWidth={1.4} />
              <span>{translate("timer.todo.empty")}</span>
            </div>
          )}
        </div>

        <div className="timer-log">
          <div className="timer-side__title">{translate("timer.history.title")}</div>
          {sessions.length === 0 && <p className="timer-log__empty">{translate("timer.history.empty")}</p>}
          {sessions.map((session, index) => (
            <div className="timer-log__row" key={`${session.startedAt}-${index}`}>
              <span className="timer-log__time">{session.startedAt}</span>
              <span className="timer-log__title">{session.todoId ? titles.get(session.todoId) ?? translate("timer.history.deletedTodo") : translate("timer.history.noTodo")}</span>
              <span className="timer-log__minutes">{translate("timer.duration.minutes", { minutes: session.minutes })}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
