import { translate } from "../../i18n/i18n";
import type { ScrapItem } from "@mono/contracts";

export type SortKey = "recent" | "oldest" | "title" | "comments";

export const sortKeys: SortKey[] = ["recent", "oldest", "title", "comments"];

export const sortLabels: Record<SortKey, string> = {
  recent: translate("scrap.sort.newest"),
  oldest: translate("scrap.sort.oldest"),
  title: translate("scrap.sort.name"),
  comments: translate("scrap.sort.mostComments"),
};

export const sortStorageKey = "mono:scrap-sort";

export function loadSortKey(): SortKey {
  try {
    const stored = localStorage.getItem(sortStorageKey);
    if (stored && (sortKeys as string[]).includes(stored)) return stored as SortKey;
  } catch { /* localStorage 불가 환경 — 기본 정렬 */ }
  return "recent";
}

// savedAt은 ISO 8601 문자열이라 사전순 비교가 곧 시간순 비교다.
export function sortItems(items: ScrapItem[], key: SortKey): ScrapItem[] {
  const sorted = [...items];
  if (key === "oldest") return sorted.sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  if (key === "title") return sorted.sort((a, b) => a.title.localeCompare(b.title, "ko"));
  if (key === "comments") return sorted.sort((a, b) => b.comments.length - a.comments.length || b.savedAt.localeCompare(a.savedAt));
  return sorted.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
