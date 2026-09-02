const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function parseIsoLocal(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** 로컬 시계 기준 오늘을 YYYY-MM-DD로 반환한다. */
export function currentIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type WeekdayStyle = "long" | "short" | "none";

/** YYYY-MM-DD → "2026년 8월 5일 수요일"(long) · "… (수)"(short) · "…"(none). */
export function koreanDateLabel(iso: string, weekday: WeekdayStyle = "long"): string {
  const date = parseIsoLocal(iso);
  const base = `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
  const name = WEEKDAYS[date.getDay()];
  if (weekday === "none") return base;
  return weekday === "short" ? `${base} (${name})` : `${base} ${name}요일`;
}

/** YYYY-MM-DD → "2026년 8월". */
export function koreanMonthLabel(iso: string): string {
  const date = parseIsoLocal(iso);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
}

/**
 * ISO 타임스탬프 → "2026. 08. 27. 09:38"(로컬 시계). 파싱 불가한 값(mock의 "방금",
 * "2분 전" 등 사람이 읽는 문자열)은 그대로 돌려준다.
 */
export function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const date = new Date(parsed);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}. ${pad(date.getMonth() + 1)}. ${pad(date.getDate())}. ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
