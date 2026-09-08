import { translate } from "../../i18n/i18n";
import { currentIsoDate } from "@mono/domain";
import { Button, Icon, IconButton } from "@mono/ui";
import { useEffect, useMemo, useState } from "react";
import {
  LocalStorageTimerSessionStore,
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

/** "M:SS" → total seconds; a bare number is read as minutes (keeps the old muscle memory). */
function parseDuration(raw: string): number | null {
  const text = raw.trim();
  const clock = /^(\d+):([0-5]?\d)$/.exec(text);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  if (/^\d+$/.test(text)) return Number(text) * 60;
  return null;
}

function startedAtOf(now: Date) {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

interface TimerPageProps {
  sessionStore?: TimerSessionStore;
  settingsStore?: TimerSettingsStore;
  alarm?: Alarm;
}

export function TimerPage({ sessionStore, settingsStore, alarm: alarmProp }: TimerPageProps) {
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

  const [settings, setSettings] = useState<TimerSettings>(() => preferences.read());
  const [remaining, setRemaining] = useState(() => preferences.read().focusSeconds);
  // The end time (epoch ms) while running. Remaining seconds must be recomputed on every tick, or setInterval drift accumulates.
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [sessions, setSessions] = useState<TimerSession[]>(() => store.read(today));
  // Whether focus just ended and the alarm is currently ringing. Won't move to the next session until it's turned off.
  const [ringing, setRinging] = useState(false);
  // Whether the duration is being edited by tapping the large number. The text is only parsed on commit (blur/Enter).
  const [editingDuration, setEditingDuration] = useState(false);
  const [durationDraft, setDurationDraft] = useState<string | null>(null);

  const total = settings.focusSeconds;
  const running = endsAt !== null;
  // The duration can only be edited when neither counting down nor ringing (includes before start and while paused).
  const canEditDuration = !running && !ringing;

  const focusedSeconds = sessions.reduce((sum, session) => sum + session.seconds, 0);

  useEffect(() => {
    if (endsAt === null) return;
    // setEndsAt(null) alone isn't enough — the next tick can fire again before this effect is cleaned up, recording the session multiple times.
    // At the moment it ends, stop this interval directly and use a flag to prevent re-entry.
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
    // finishFocus is recreated on every render, so it's not put in the dependency array — the value comes in via settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt, settings]);

  // The settings modal is in the same window, so no storage event fires. Listens for the event dispatched on save instead.
  useEffect(() => {
    const reload = () => {
      const next = preferences.read();
      setSettings(next);
      // Doesn't touch a session that's currently running. Only applies the new duration while stopped.
      setEndsAt((current) => {
        if (current === null) setRemaining(next.focusSeconds);
        return current;
      });
    };
    window.addEventListener(TIMER_SETTINGS_EVENT, reload);
    return () => window.removeEventListener(TIMER_SETTINGS_EVENT, reload);
  }, [preferences]);

  // Stops a ringing alarm when leaving the page.
  useEffect(() => () => alarm.stop(), [alarm]);

  // Brings the app window to the front when the notification banner is clicked.
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
    setRemaining(settings.focusSeconds);
    setEndsAt(null);
  }

  function finishFocus(record: boolean) {
    if (record) {
      setSessions(store.append(today, {
        startedAt: startedAtOf(new Date(Date.now() - settings.focusSeconds * 1000)),
        seconds: settings.focusSeconds,
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

  function commitDurationDraft() {
    const raw = durationDraft;
    setDurationDraft(null);
    setEditingDuration(false);
    if (raw === null || raw.trim() === "") return;
    const seconds = parseDuration(raw);
    if (seconds === null) return;
    const next = normalizeTimerSettings({ ...settings, focusSeconds: seconds });
    setSettings(next);
    preferences.write(next);
    setRemaining(next.focusSeconds);
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

  return (
    <div className="timer-page">
      <section className="timer-stage">
        <div className={`timer-digits ${ringing ? "timer-digits--ringing" : ""}`}>
          {editingDuration && canEditDuration ? (
            <input
              aria-label={translate("timer.adjust.label")}
              autoFocus
              className="timer-digits__input"
              onBlur={commitDurationDraft}
              onChange={(event) => setDurationDraft(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  setDurationDraft(null);
                  setEditingDuration(false);
                }
              }}
              type="text"
              value={durationDraft ?? formatClock(settings.focusSeconds)}
            />
          ) : canEditDuration ? (
            <button
              className="timer-digits__edit"
              onClick={() => setEditingDuration(true)}
              title={translate("timer.adjust.edit")}
              type="button"
            >
              {formatClock(remaining)}
            </button>
          ) : (
            formatClock(remaining)
          )}
        </div>
        <div className="timer-bar" hidden={editingDuration && canEditDuration}>
          <span style={{ width: `${Math.round(((total - remaining) / total) * 100)}%` }} />
        </div>

        <div className="timer-tally">
          <span>{translate("todo.filter.today")}</span>
          <div className="timer-pips">
            {Array.from({ length: DAILY_GOAL }, (_, index) => (
              <i className={index < sessions.length ? "timer-pip timer-pip--done" : "timer-pip"} key={index} />
            ))}
          </div>
          <span className="timer-tally__count">{sessions.length} / {DAILY_GOAL}</span>
          {focusedSeconds > 0 && <span className="timer-tally__count">{translate("timer.duration.hoursMinutes", { hours: Math.floor(focusedSeconds / 3600), minutes: Math.round((focusedSeconds % 3600) / 60) })}</span>}
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
        <div className="timer-log">
          <div className="timer-side__title">{translate("timer.history.title")}</div>
          {sessions.length === 0 && <p className="timer-log__empty">{translate("timer.history.empty")}</p>}
          {sessions.map((session, index) => (
            <div className="timer-log__row" key={`${session.startedAt}-${index}`}>
              <span className="timer-log__time">{session.startedAt}</span>
              <span className="timer-log__minutes">{formatClock(session.seconds)}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
