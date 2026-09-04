import { translate } from "./i18n";
import type { TranslationKey } from "./messages.ko";

// Error 메시지는 그대로, 문자열은 그대로, 그 외에는 지정한 fallback 문구.
// 이전에 각 feature 페이지에 복붙돼 있던 errorMessage 헬퍼의 superset.
export function errorMessage(error: unknown, fallbackKey: TranslationKey = "common.error.actionFailed"): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return translate(fallbackKey);
}
