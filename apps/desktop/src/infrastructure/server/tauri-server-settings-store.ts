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

/** Tauri 밖(브라우저 `npm run dev`)에서 화면이 깨지지 않도록 하는 읽기 전용 상태. */
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
    if (!isTauri()) throw new Error(translate("server.text.006"));
    return invoke<ServerConnection>("save_server_connection", {
      mode,
      apiBaseUrl: mode === "remote" ? trimBaseUrl(remoteUrl ?? "") : null,
      apiToken: mode === "remote" && (token ?? "").trim() ? token!.trim() : null,
    });
  }

  async probe(baseUrl: string, token?: string): Promise<void> {
    const base = trimBaseUrl(baseUrl);
    const bearer = (token ?? "").trim();

    // 1. 도달 가능성 + mono 서버인지 — /health는 인증 없음.
    const health = await this.fetchWithTimeout(`${base}/health`);
    if (!health.ok) throw new Error(translate("server.text.007", { value1: health.status }));
    if ((await health.text()).trim() !== "ok") {
      throw new Error(translate("server.text.008"));
    }

    // 2. 토큰 유효성 — 인증 걸린 엔드포인트가 401이면 토큰이 없거나 틀린 것.
    const authed = await this.fetchWithTimeout(
      `${base}/todo/snapshot`,
      bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : {},
    );
    if (authed.status === 401) {
      throw new Error(bearer ? translate("server.text.004") : translate("server.text.005"));
    }
  }

  private async fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
    } catch {
      throw new Error(translate("server.text.003"));
    } finally {
      clearTimeout(timer);
    }
  }

  async restart(): Promise<void> {
    if (!isTauri()) throw new Error(translate("server.text.009"));
    await invoke("restart_app");
  }
}
