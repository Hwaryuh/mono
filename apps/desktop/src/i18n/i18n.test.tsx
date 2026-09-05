import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { I18nProvider, LOCALE_STORAGE_KEY, readLocale, useI18n } from "./i18n";
import { koMessages } from "./messages.ko";

describe("i18n", () => {
  it("falls back to Korean for an unsupported stored value", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    expect(readLocale(localStorage)).toBe("ko");
  });

  it("provides Korean messages and date format and persists the selection", () => {
    const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;
    const { result } = renderHook(() => useI18n(), { wrapper });

    expect(result.current.t("app.navigation.dashboard")).toBe("대시보드");
    expect(result.current.formatDate("2026-08-30", "short")).toBe("2026년 8월 30일 (일)");
    expect(result.current.formatMonth("2026-08-30")).toBe("2026년 8월");
    act(() => result.current.setLocale("ko"));
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ko");
    expect(document.documentElement).toHaveAttribute("lang", "ko-KR");
  });

  it("keeps keys meaningful and messages self-contained", () => {
    for (const [key, message] of Object.entries(koMessages)) {
      expect(key).not.toMatch(/\.text\.\d+$/);
      expect(message).not.toMatch(/\{value\d+\}/);
      expect(message).toBe(message.trim());
    }
  });
});
