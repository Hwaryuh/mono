/** 세션이 끝나면 OS 알림 배너를 띄운다. Tauri 밖(브라우저 개발·테스트)에서는 조용히 무시한다. */

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function notifySessionEnd(title: string, body: string): Promise<void> {
  if (!inTauri()) return;
  try {
    const mod = await import("@tauri-apps/plugin-notification");
    const granted = (await mod.isPermissionGranted()) || (await mod.requestPermission()) === "granted";
    if (granted) mod.sendNotification({ title, body });
  } catch {
    // 알림 권한이 없거나 런타임이 막혀 있으면 소리 알람만으로 충분하다.
  }
}

/** 알림 배너를 클릭하면 handler 를 부른다. 해제 함수를 돌려준다. */
export async function onNotificationClick(handler: () => void): Promise<() => void> {
  if (!inTauri()) return () => {};
  try {
    const mod = await import("@tauri-apps/plugin-notification");
    const listener = await mod.onAction(() => handler());
    return () => void listener.unregister();
  } catch {
    return () => {};
  }
}

/** 최소화·백그라운드 상태의 앱 창을 앞으로 가져온다. */
export async function focusAppWindow(): Promise<void> {
  if (!inTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.unminimize();
    await win.show();
    await win.setFocus();
  } catch {
    // 창 제어가 막혀 있으면 무시한다.
  }
}
