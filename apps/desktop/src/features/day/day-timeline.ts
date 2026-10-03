import type { DayEntry } from "@mono/contracts";

/** A gap at least this long between entries is drawn as a fillable "빈 시간" block. */
export const GAP_MINUTES = 15;

const DAY = 24 * 60;

export function clockToMinutes(clock: string): number {
  return Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
}

export function minutesToClock(minutes: number): string {
  const wrapped = ((minutes % DAY) + DAY) % DAY;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/** An end at or before the start means the range ran past midnight. */
export function spanMinutes(startTime: string, endTime: string): number {
  const start = clockToMinutes(startTime);
  const end = clockToMinutes(endTime);
  return end > start ? end - start : end + DAY - start;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** "9" · "930" · "9:30" · "09:30" → "09:30". Anything else → null. */
export function parseClock(raw: string): string | null {
  const match = /^(\d{1,2}):?(\d{2})?$/.exec(raw);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  if (hours > 23 || minutes > 59) return null;
  return minutesToClock(hours * 60 + minutes);
}

export type EntryDraft = { startTime: string; endTime: string; title: string };
export type DraftResult = EntryDraft | { error: "needsStart" | "sameTime" } | null;

/**
 * The quick-entry line. `chainStart` is where the previous entry ended (null on an empty day).
 *   "9-10:30 기획" → 09:00–10:30   (a range is inserted as written)
 *   "10:30 기획"   → chain–10:30    (just the end time continues the chain)
 *   "기획"         → chain–now
 */
export function parseEntryDraft(text: string, chainStart: string | null, now: string): DraftResult {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let result: EntryDraft | null = null;

  const range = /^(\S+?)\s*[-~]\s*(\S+)\s+(.+)$/.exec(trimmed);
  const rangeStart = range && parseClock(range[1]);
  const rangeEnd = range && parseClock(range[2]);
  if (range && rangeStart && rangeEnd) {
    result = { startTime: rangeStart, endTime: rangeEnd, title: range[3].trim() };
  } else {
    const ending = /^(\S+)\s+(.+)$/.exec(trimmed);
    const endTime = ending && parseClock(ending[1]);
    if (chainStart === null) return { error: "needsStart" };
    result = ending && endTime
      ? { startTime: chainStart, endTime, title: ending[2].trim() }
      : { startTime: chainStart, endTime: now, title: trimmed };
  }
  return result.startTime === result.endTime ? { error: "sameTime" } : result;
}

/** Where the next chained entry starts: the latest end among the day's entries. */
export function chainStartOf(entries: DayEntry[]): string | null {
  let latest: number | null = null;
  for (const entry of entries) {
    const end = clockToMinutes(entry.startTime) + spanMinutes(entry.startTime, entry.endTime);
    latest = latest === null ? end : Math.max(latest, end);
  }
  return latest === null ? null : minutesToClock(latest);
}

export type TimelineRow =
  | { kind: "entry"; entry: DayEntry; minutes: number; overlaps: boolean; crossesMidnight: boolean }
  | { kind: "gap"; startTime: string; endTime: string; minutes: number };

export type Timeline = { rows: TimelineRow[]; loggedMinutes: number; gapMinutes: number };

export function buildTimeline(entries: DayEntry[]): Timeline {
  const sorted = [...entries].sort((a, b) => clockToMinutes(a.startTime) - clockToMinutes(b.startTime));
  const rows: TimelineRow[] = [];
  let loggedMinutes = 0;
  let gapMinutes = 0;
  let latestEnd: number | null = null;

  for (const entry of sorted) {
    const start = clockToMinutes(entry.startTime);
    const minutes = spanMinutes(entry.startTime, entry.endTime);
    if (latestEnd !== null && start - latestEnd >= GAP_MINUTES) {
      rows.push({ kind: "gap", startTime: minutesToClock(latestEnd), endTime: entry.startTime, minutes: start - latestEnd });
      gapMinutes += start - latestEnd;
    }
    rows.push({ kind: "entry", entry, minutes, overlaps: latestEnd !== null && start < latestEnd, crossesMidnight: start + minutes > DAY });
    loggedMinutes += minutes;
    latestEnd = latestEnd === null ? start + minutes : Math.max(latestEnd, start + minutes);
  }
  return { rows, loggedMinutes, gapMinutes };
}
