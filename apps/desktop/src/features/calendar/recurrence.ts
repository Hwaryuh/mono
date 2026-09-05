import type { CalendarEvent, CalendarRecurrence } from "@mono/contracts";

// A collection of pure functions kept in sync with the server's calendar.rs expansion logic. Used by the mock repository.
// All dates are "YYYY-MM-DD" (UTC-based).

function toUtc(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = toUtc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return fromUtc(date);
}

export function weekdayOf(iso: string): number {
  return toUtc(iso).getUTCDay();
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

function addMonths(iso: string, months: number): string | null {
  const [year, month, day] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const y = target.getUTCFullYear();
  const m = target.getUTCMonth();
  const probe = new Date(Date.UTC(y, m, day));
  return probe.getUTCMonth() === m ? fromUtc(probe) : null; // skipped if that month has no matching day-of-month
}

function addYears(iso: string, years: number): string | null {
  const [year, month, day] = iso.split("-").map(Number);
  const probe = new Date(Date.UTC(year + years, month - 1, day));
  return probe.getUTCMonth() === month - 1 ? fromUtc(probe) : null; // Feb 29 → skipped in non-leap years
}

export function occurrenceSlots(rule: CalendarRecurrence, startDate: string, windowEnd: string): string[] {
  const limit = rule.count ?? Number.MAX_SAFE_INTEGER;
  const interval = Math.max(1, rule.interval);
  const past = (date: string) => (rule.until != null && date > rule.until) || date > windowEnd;
  const out: string[] = [];

  if (rule.freq === "daily") {
    let cursor = startDate;
    while (out.length < limit && !past(cursor)) {
      out.push(cursor);
      cursor = addDays(cursor, interval);
    }
  } else if (rule.freq === "weekly") {
    const weekdays = (rule.weekdays.length ? [...new Set(rule.weekdays)] : [weekdayOf(startDate)])
      .filter((d) => d >= 0 && d <= 6)
      .sort((a, b) => a - b);
    const weekStart = addDays(startDate, -weekdayOf(startDate));
    for (let block = 0; block <= 1200; block += 1) {
      const base = addDays(weekStart, block * 7 * interval);
      if (base > windowEnd) break;
      let stop = false;
      for (const weekday of weekdays) {
        const date = addDays(base, weekday);
        if (date < startDate) continue;
        if (out.length >= limit || past(date)) { stop = true; break; }
        out.push(date);
      }
      if (stop) break;
    }
  } else if (rule.freq === "monthly") {
    for (let step = 0; step <= 2400; step += 1) {
      const date = addMonths(startDate, step * interval);
      if (date == null) continue;
      if (date < startDate) continue;
      if (out.length >= limit || past(date)) break;
      out.push(date);
    }
  } else if (rule.freq === "yearly") {
    for (let step = 0; step <= 400; step += 1) {
      const date = addYears(startDate, step * interval);
      if (date == null) continue;
      if (date < startDate) continue;
      if (out.length >= limit || past(date)) break;
      out.push(date);
    }
  }
  return out;
}

export type CalendarException = {
  masterId: string;
  occurrenceDate: string;
  kind: "cancelled" | "modified";
  override: Partial<Pick<CalendarEvent, "title" | "startDate" | "startTime" | "endDate" | "endTime" | "location" | "categoryId" | "note">> | null;
};

export function expandMaster(
  master: CalendarEvent,
  from: string,
  to: string,
  exceptions: CalendarException[],
): CalendarEvent[] {
  const spanDays = Math.max(0, daysBetween(master.startDate, master.endDate));

  if (master.recurrence == null) {
    return master.endDate >= from && master.startDate <= to ? [{ ...master, seriesId: null, occurrenceDate: null }] : [];
  }

  const out: CalendarEvent[] = [];
  for (const slot of occurrenceSlots(master.recurrence, master.startDate, to)) {
    const exception = exceptions.find((ex) => ex.masterId === master.id && ex.occurrenceDate === slot);
    if (exception?.kind === "cancelled") continue;
    const base: CalendarEvent = {
      ...master,
      id: `${master.id}::${slot}`,
      startDate: slot,
      endDate: addDays(slot, spanDays),
      seriesId: master.id,
      occurrenceDate: slot,
    };
    const event = exception?.override ? { ...base, ...exception.override } : base;
    if (event.endDate >= from) out.push(event);
  }
  return out;
}
