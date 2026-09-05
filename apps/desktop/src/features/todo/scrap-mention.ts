import { translate } from "../../i18n/i18n";

// A scrap-reference token embedded inline in a todo's title/note string. The id is the source of the link,
// and the display name is freshly looked up from the scrap snapshot on every render (so scrap renames are picked up automatically).
// id can be either a server UUID (`uuid::Uuid::new_v4`) or the mock repository's `scrap-N`.
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

// For read-only surfaces (todo rows, dashboard, aria labels, delete confirmation). Converts a token → plain "#displayName" text.
export function resolveScrapMentions(text: string, scraps: ScrapRef[]): string {
  return text.replace(scrapMentionPattern, (_, id: string) => `#${displayNameOf(id, scraps)}`);
}
