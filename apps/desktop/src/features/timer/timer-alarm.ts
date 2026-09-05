/**
 * An alarm that keeps ringing after a session ends until the user turns it off.
 * The sound is played directly to OS audio by Rust (rodio) — it keeps ringing even if the window is hidden or minimized.
 * Silently ignored outside Tauri (browser dev/testing).
 */
export interface Alarm {
  start(): void;
  stop(): void;
}

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function send(command: "alarm_start" | "alarm_stop"): void {
  if (!inTauri()) return;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke(command))
    .catch(() => {
      // If there's no audio device or the runtime call is blocked, the OS notification alone is enough.
    });
}

export function createAlarm(): Alarm {
  return {
    start: () => send("alarm_start"),
    stop: () => send("alarm_stop"),
  };
}
