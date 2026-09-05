const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function parseIsoLocal(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Returns today, based on the local clock, as YYYY-MM-DD. */
export function currentIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type WeekdayStyle = "long" | "short" | "none";

/** YYYY-MM-DD → "August 5, 2026, Wednesday"(long) · "… (Wed)"(short) · "…"(none). */
export function koreanDateLabel(iso: string, weekday: WeekdayStyle = "long"): string {
  const date = parseIsoLocal(iso);
  const base = `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
  const name = WEEKDAYS[date.getDay()];
  if (weekday === "none") return base;
  return weekday === "short" ? `${base} (${name})` : `${base} ${name}요일`;
}

/** YYYY-MM-DD → "August 2026". */
export function koreanMonthLabel(iso: string): string {
  const date = parseIsoLocal(iso);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

/**
 * ISO timestamp → "2026. 08. 27. 09:38" (local clock). A value that can't be parsed (the mock's "just now",
 * "2 minutes ago", etc. — human-readable strings) is returned as-is.
 */
export function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const date = new Date(parsed);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}. ${pad(date.getMonth() + 1)}. ${pad(date.getDate())}. ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
