import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

const WEB_PROTOCOLS = new Set(["http:", "https:"]);

export interface ExternalUrlOpener {
  open(url: string): Promise<void>;
}

export class PlatformExternalUrlOpener implements ExternalUrlOpener {
  private constructor() {}

  static of(): PlatformExternalUrlOpener {
    return new PlatformExternalUrlOpener();
  }

  async open(url: string): Promise<void> {
    if (isTauri()) {
      await openUrl(url);
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function externalUrlOf(value: string): string | null {
  const trimmedValue = value.trim();
  if (!trimmedValue) return null;

  try {
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmedValue) ? trimmedValue : `https://${trimmedValue}`;
    const parsedUrl = new URL(candidate);
    return WEB_PROTOCOLS.has(parsedUrl.protocol) ? parsedUrl.href : null;
  } catch {
    return null;
  }
}
