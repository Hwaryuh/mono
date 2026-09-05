import { normalizeColorToOklch, relativeLuminanceOfColor } from "@mono/domain";

export const DEFAULT_ACCENT_COLOR = "oklch(0.525 0.154 10.471)";
export const ACCENT_COLOR_STORAGE_KEY = "mono:accent-color";

const LIGHT_FOREGROUND = "oklch(1 0 0)";
const DARK_FOREGROUND = "oklch(0.222 0.002 106.554)";

export interface AccentColorPreferenceStore {
  read(): string;
  write(color: string): void;
}

export class LocalStorageAccentColorPreferenceStore implements AccentColorPreferenceStore {
  private constructor(private readonly storage: Storage) {}

  static of(storage: Storage): LocalStorageAccentColorPreferenceStore {
    return new LocalStorageAccentColorPreferenceStore(storage);
  }

  read(): string {
    try {
      const storedColor = this.storage.getItem(ACCENT_COLOR_STORAGE_KEY);
      return storedColor ? normalizeColorToOklch(storedColor) ?? DEFAULT_ACCENT_COLOR : DEFAULT_ACCENT_COLOR;
    } catch {
      return DEFAULT_ACCENT_COLOR;
    }
  }

  write(color: string): void {
    const normalized = normalizeColorToOklch(color);
    if (!normalized) return;

    try {
      this.storage.setItem(ACCENT_COLOR_STORAGE_KEY, normalized);
    } catch {
      // Even if storage is blocked, the current session's theme change is kept.
    }
  }
}

export function accentForegroundOf(accentColor: string): string {
  const accentLuminance = relativeLuminanceOfColor(accentColor) ?? 0;
  const lightContrast = contrastRatio(accentLuminance, relativeLuminanceOfColor(LIGHT_FOREGROUND) ?? 1);
  const darkContrast = contrastRatio(accentLuminance, relativeLuminanceOfColor(DARK_FOREGROUND) ?? 0);
  return darkContrast > lightContrast ? DARK_FOREGROUND : LIGHT_FOREGROUND;
}

function contrastRatio(firstLuminance: number, secondLuminance: number): number {
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}
