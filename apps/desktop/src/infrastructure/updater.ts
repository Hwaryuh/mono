import { isTauri } from "@tauri-apps/api/core";

/** 설치 대기 중인 업데이트. Tauri 밖(웹 미리보기·테스트)에서는 항상 null. */
export interface PendingUpdate {
  version: string;
  currentVersion: string;
  notes?: string;
  /** 내려받아 설치한다. onProgress는 (내려받은 바이트, 전체 바이트 or undefined). */
  downloadAndInstall(onProgress?: (downloaded: number, total: number | undefined) => void): Promise<void>;
  /** 설치 후 앱을 다시 실행한다. 성공하면 반환하지 않는다. */
  relaunch(): Promise<void>;
}

/**
 * GitHub 릴리스의 latest.json을 조회한다. 새 버전이 있으면 PendingUpdate, 없으면 null.
 * 플러그인은 서명(tauri.conf.json plugins.updater.pubkey)을 검증한 뒤에만 설치한다.
 */
export async function checkForUpdate(): Promise<PendingUpdate | null> {
  if (!isTauri()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body,
    async downloadAndInstall(onProgress) {
      let downloaded = 0;
      let total: number | undefined;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          onProgress?.(downloaded, total);
        }
      });
    },
    async relaunch() {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
  };
}
