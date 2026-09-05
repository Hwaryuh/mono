import { translate } from "./i18n";
import type { TranslationKey } from "./messages.ko";

// An Error's message is used as-is, a string is used as-is, anything else falls back to the given fallback text.
// A superset of the errorMessage helper that used to be copy-pasted into each feature page.
export function errorMessage(error: unknown, fallbackKey: TranslationKey = "common.error.actionFailed"): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return translate(fallbackKey);
}
