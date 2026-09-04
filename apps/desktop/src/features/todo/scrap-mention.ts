import { translate } from "../../i18n/i18n";

// 할 일 제목·메모 문자열에 인라인으로 박히는 스크랩 참조 토큰. id가 링크의 원본이고,
// 표시 이름은 렌더 시 스크랩 스냅샷에서 매번 새로 조회한다(스크랩 개명이 자동 반영).
// id는 서버 UUID(`uuid::Uuid::new_v4`) 또는 목 저장소의 `scrap-N` 둘 다 온다.
export const scrapMentionPattern = /@\[scrap:([0-9a-zA-Z_-]+)\]/g;

export type ScrapRef = { id: string; title: string };

export type MentionSegment =
  | { type: "text"; text: string }
  | { type: "mention"; id: string };

export function scrapMentionToken(id: string): string {
  return `@[scrap:${id}]`;
}

export function parseScrapMentions(text: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(scrapMentionPattern)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ type: "text", text: text.slice(cursor, start) });
    segments.push({ type: "mention", id: match[1] });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) segments.push({ type: "text", text: text.slice(cursor) });
  return segments;
}

export function extractScrapMentionIds(text: string): string[] {
  return [...text.matchAll(scrapMentionPattern)].map((match) => match[1]);
}

export function displayNameOf(id: string, scraps: ScrapRef[]): string {
  const scrap = scraps.find((candidate) => candidate.id === id);
  if (!scrap) return translate("todo.mention.missing");
  return scrap.title.trim() || translate("todo.mention.untitled");
}

// 읽기 전용 표면(할 일 행, 대시보드, aria 라벨, 삭제 확인)용. 토큰 → "#표시이름" 평문.
export function resolveScrapMentions(text: string, scraps: ScrapRef[]): string {
  return text.replace(scrapMentionPattern, (_, id: string) => `#${displayNameOf(id, scraps)}`);
}
