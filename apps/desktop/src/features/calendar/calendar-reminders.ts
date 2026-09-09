import { useEffect, useRef } from "react";
import type { CalendarEvent } from "@mono/contracts";
import { translate } from "../../i18n/i18n";
// ponytail: reuse the timer's OS-notification helper (it's just (title, body)).
import { notifySessionEnd as notify } from "../timer/timer-notify";

const FIRED_KEY = "mono:calendar-reminders-fired";
// Fire a reminder only if the current tick lands within this window after its target time.
// Wide enough to absorb a throttled background tick, narrow enough not to replay a stale reminder
// when the app was closed for hours.
const CATCH_UP_MS = 10 * 60_000;
const CHECK_MS = 30_000;

function eventStartMs(event: CalendarEvent): number | null {
  const ms = new Date(`${event.startDate}T${event.startTime ?? "09:00"}`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function firedKey(event: CalendarEvent): string {
  return `${event.seriesId ?? event.id}:${event.occurrenceDate ?? event.startDate}:${event.reminderMinutes}`;
}

function loadFired(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FIRED_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function saveFired(fired: Set<string>): void {
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify([...fired].slice(-200)));
  } catch {
    // A blocked storage just means a reminder could repeat after a reload — acceptable.
  }
}

/** Checks every 30s (while the app runs, incl. hidden in the tray) whether any event's reminder is due. */
export function checkCalendarReminders(events: CalendarEvent[], now: number, fired: Set<string>): string[] {
  const titles: string[] = [];
  for (const event of events) {
    if (event.reminderMinutes === null) continue;
    const start = eventStartMs(event);
    if (start === null) continue;
    const fireAt = start - event.reminderMinutes * 60_000;
    if (now < fireAt || now > fireAt + CATCH_UP_MS) continue;
    const key = firedKey(event);
    if (fired.has(key)) continue;
    fired.add(key);
    titles.push(event.title);
  }
  return titles;
}

export function useCalendarReminders(events: CalendarEvent[] | undefined): void {
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    const tick = () => {
      const list = eventsRef.current;
      if (!list?.length) return;
      const fired = loadFired();
      const due = checkCalendarReminders(list, Date.now(), fired);
      if (due.length === 0) return;
      saveFired(fired);
      for (const title of due) void notify(title, translate("calendar.reminder.notifyBody"));
    };
    tick();
    const timer = window.setInterval(tick, CHECK_MS);
    return () => window.clearInterval(timer);
  }, []);
}
