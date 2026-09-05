import { hexToOklch, normalizeColorToOklch, oklchToHex } from "@mono/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ACCENT_COLOR_STORAGE_KEY,
  accentForegroundOf,
  DEFAULT_ACCENT_COLOR,
  LocalStorageAccentColorPreferenceStore,
} from "./accent-color-preference";

describe("OKLCH color", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips an sRGB HEX value to a visually equivalent OKLCH color", () => {
    expect(hexToOklch("#b03a55")).toBe("oklch(0.525 0.154 10.471)");
    expect(oklchToHex("oklch(0.525 0.154 10.471)")).toBe("#b03a55");
    expect(normalizeColorToOklch("invalid")).toBeNull();
  });

  it("migrates a legacy HEX accent color to OKLCH when read", () => {
    localStorage.setItem(ACCENT_COLOR_STORAGE_KEY, "#b03a55");

    expect(LocalStorageAccentColorPreferenceStore.of(localStorage).read()).toBe(DEFAULT_ACCENT_COLOR);
  });

  it("picks the foreground color with higher contrast against the accent color", () => {
    expect(accentForegroundOf(DEFAULT_ACCENT_COLOR)).toBe("oklch(1 0 0)");
    expect(accentForegroundOf("oklch(0.873 0.14 93.538)")).toBe("oklch(0.222 0.002 106.554)");
  });
});
