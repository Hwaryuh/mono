import { isTauri } from "@tauri-apps/api/core";

/** An update waiting to be installed. Always null outside Tauri (web preview/tests). */
export interface PendingUpdate {
  version: string;
  currentVersion: string;
  notes?: string;
  /** Downloads and installs it. onProgress receives (bytes downloaded, total bytes or undefined). */
  downloadAndInstall(onProgress?: (downloaded: number, total: number | undefined) => void): Promise<void>;
  /** Relaunches the app after installation. Does not return on success. */
  relaunch(): Promise<void>;
}

/**
 * Queries the GitHub release's latest.json. Returns a PendingUpdate if a new version exists, otherwise null.
 * The plugin only installs after verifying the signature (tauri.conf.json plugins.updater.pubkey).
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
