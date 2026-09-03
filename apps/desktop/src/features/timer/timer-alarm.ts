/**
 * 세션이 끝나면 사용자가 끌 때까지 이어서 울리는 알람.
 * 소리는 Rust(rodio)가 OS 오디오에 직접 재생한다 — 창이 가려지거나 최소화돼도 계속 울린다.
 * Tauri 밖(브라우저 개발·테스트)에서는 조용히 무시한다.
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
      // 오디오 장치가 없거나 런타임이 막혀 있으면 OS 알림만으로 충분하다.
    });
}

export function createAlarm(): Alarm {
  return {
    start: () => send("alarm_start"),
    stop: () => send("alarm_stop"),
  };
}
