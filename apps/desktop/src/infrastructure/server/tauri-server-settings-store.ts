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

  async save({ mode, remoteUrl }: SaveServerConnectionInput): Promise<ServerConnection> {
    if (!isTauri()) throw new Error("웹 미리보기에서는 서버 설정을 바꿀 수 없습니다.");
    return invoke<ServerConnection>("save_server_connection", {
      mode,
      apiBaseUrl: mode === "remote" ? trimBaseUrl(remoteUrl ?? "") : null,
    });
  }

  async probe(baseUrl: string): Promise<void> {
    const base = trimBaseUrl(baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${base}/health`, { signal: controller.signal, cache: "no-store" });
    } catch {
      throw new Error("서버에 연결할 수 없습니다. 주소와 Tailscale 연결을 확인하세요.");
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new Error(`서버가 오류를 반환했습니다. (HTTP ${response.status})`);
    }
    const body = (await response.text()).trim();
    if (body !== "ok") {
      throw new Error("이 주소는 mono API 서버가 아닌 것 같습니다.");
    }
  }

  async restart(): Promise<void> {
    if (!isTauri()) throw new Error("웹 미리보기에서는 앱을 다시 시작할 수 없습니다.");
    await invoke("restart_app");
  }
}
