import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { I18nProvider, LOCALE_STORAGE_KEY, readLocale, useI18n } from "./i18n";
import { koMessages } from "./messages.ko";

describe("i18n", () => {
  it("지원하지 않는 저장값은 한국어로 복구한다", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    expect(readLocale(localStorage)).toBe("ko");
  });

  it("한국어 메시지와 날짜 형식을 제공하고 선택을 저장한다", () => {
    const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;
    const { result } = renderHook(() => useI18n(), { wrapper });

    expect(result.current.t("app.navigation.dashboard")).toBe("대시보드");
    expect(result.current.formatDate("2026-08-30", "short")).toBe("2026년 8월 30일 (일)");
    expect(result.current.formatMonth("2026-08-30")).toBe("2026년 8월");
    act(() => result.current.setLocale("ko"));
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ko");
    expect(document.documentElement).toHaveAttribute("lang", "ko-KR");
  });

  it("의미가 드러나는 키와 독립된 메시지를 유지한다", () => {
    for (const [key, message] of Object.entries(koMessages)) {
      expect(key).not.toMatch(/\.text\.\d+$/);
      expect(message).not.toMatch(/\{value\d+\}/);
      expect(message).toBe(message.trim());
    }
  });
});
