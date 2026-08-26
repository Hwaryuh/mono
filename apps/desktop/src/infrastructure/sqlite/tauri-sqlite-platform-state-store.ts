import { invoke } from "@tauri-apps/api/core";
import type { MockPlatformState } from "../mock/mock-platform-state";
import type { PlatformStateStore } from "./platform-state-store";

export class PlatformPersistenceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PlatformPersistenceError";
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export class TauriSqlitePlatformStateStore implements PlatformStateStore {
  async load() {
    try {
      const payload = await invoke<string | null>("load_platform_state");
      return payload === null ? null : JSON.parse(payload);
    } catch (error) {
      throw new PlatformPersistenceError(`저장된 데이터를 불러오지 못했습니다. ${errorMessage(error)}`, { cause: error });
    }
  }

  async save(state: MockPlatformState) {
    try {
      await invoke("save_platform_state", { payload: JSON.stringify(state) });
    } catch (error) {
      throw new PlatformPersistenceError(`변경 사항을 저장하지 못했습니다. ${errorMessage(error)}`, { cause: error });
    }
  }
}
