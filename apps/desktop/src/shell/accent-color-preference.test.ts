import { hexToOklch, normalizeColorToOklch, oklchToHex } from "@mono/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ACCENT_COLOR_STORAGE_KEY,
  accentForegroundOf,
  DEFAULT_ACCENT_COLOR,
  LocalStorageAccentColorPreferenceStore,
} from "./accent-color-preference";

describe("OKLCH 색상", () => {
  beforeEach(() => localStorage.clear());

  it("sRGB HEX를 시각적으로 같은 OKLCH로 왕복 변환한다", () => {
    expect(hexToOklch("#b03a55")).toBe("oklch(0.525 0.154 10.471)");
    expect(oklchToHex("oklch(0.525 0.154 10.471)")).toBe("#b03a55");
    expect(normalizeColorToOklch("invalid")).toBeNull();
  });

  it("기존 HEX 강조색을 읽을 때 OKLCH로 마이그레이션한다", () => {
    localStorage.setItem(ACCENT_COLOR_STORAGE_KEY, "#b03a55");

    expect(LocalStorageAccentColorPreferenceStore.of(localStorage).read()).toBe(DEFAULT_ACCENT_COLOR);
  });

  it("강조색과 대비가 더 높은 전경색을 고른다", () => {
    expect(accentForegroundOf(DEFAULT_ACCENT_COLOR)).toBe("oklch(1 0 0)");
    expect(accentForegroundOf("oklch(0.873 0.14 93.538)")).toBe("oklch(0.222 0.002 106.554)");
  });
});
