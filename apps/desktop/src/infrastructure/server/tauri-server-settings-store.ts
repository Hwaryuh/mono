import { translate } from "../../i18n/i18n";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  type SaveServerConnectionInput,
  type ServerConnection,
  type ServerSettingsStore,
  trimBaseUrl,
} from "./server-settings-store";

const PROBE_TIMEOUT_MS = 4_000;
const WEB_PREVIEW_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:4174";

/** A read-only state that keeps the screen from breaking outside Tauri (browser `npm run dev`). */
function webPreviewConnection(): ServerConnection {
  return {
    mode: "embedded",
    remoteUrl: "",
    remoteToken: "",
    effectiveApiBaseUrl: WEB_PREVIEW_BASE_URL,
    runningEmbedded: true,
    envOverride: false,
    manageable: false,
    restartRequired: false,
  };
}

export class TauriServerSettingsStore implements ServerSettingsStore {
  async read(): Promise<ServerConnection> {
    if (!isTauri()) return webPreviewConnection();
    return invoke<ServerConnection>("server_connection");
  }

  async save({ mode, remoteUrl, token }: SaveServerConnectionInput): Promise<ServerConnection> {
    if (!isTauri()) throw new Error(translate("server.preview.settingsUnsupported"));
    return invoke<ServerConnection>("save_server_connection", {
      mode,
      apiBaseUrl: mode === "remote" ? trimBaseUrl(remoteUrl ?? "") : null,
      apiToken: mode === "remote" && (token ?? "").trim() ? token!.trim() : null,
    });
  }

  async probe(baseUrl: string, token?: string): Promise<void> {
    const base = trimBaseUrl(baseUrl);
    const bearer = (token ?? "").trim();

    // 1. Reachability + whether it's a mono server — /health requires no auth.
    const health = await this.fetchWithTimeout(`${base}/health`);
    if (!health.ok) throw new Error(translate("server.error.httpStatus", { status: health.status }));
    if ((await health.text()).trim() !== "ok") {
      throw new Error(translate("server.validation.notMonoApi"));
    }

    // 2. Token validity — a 401 from the authenticated endpoint means the token is missing or wrong.
    const authed = await this.fetchWithTimeout(
      `${base}/todo/snapshot`,
      bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : {},
    );
    if (authed.status === 401) {
      throw new Error(bearer ? translate("server.auth.invalidToken") : translate("server.auth.tokenRequired"));
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    } catch {
      throw new Error(translate("server.error.unreachable"));
    } finally {
      clearTimeout(timer);
    }
  }

  async restart(): Promise<void> {
    if (!isTauri()) throw new Error(translate("server.preview.restartUnsupported"));
    await invoke("restart_app");
  }
}
