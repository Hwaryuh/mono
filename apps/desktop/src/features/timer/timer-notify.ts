/** Shows an OS notification banner when a session ends. Silently ignored outside Tauri (browser dev/testing). */

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
    // If notification permission is missing or the runtime call is blocked, the sound alarm alone is enough.
  }
}

/** Calls handler when the notification banner is clicked. Returns an unsubscribe function. */
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

/** Brings a minimized/backgrounded app window to the front. */
export async function focusAppWindow(): Promise<void> {
  if (!inTauri()) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.unminimize();
    await win.show();
    await win.setFocus();
  } catch {
    // Ignored if window control is blocked.
  }
}
