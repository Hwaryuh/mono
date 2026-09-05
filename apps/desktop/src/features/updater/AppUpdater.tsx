import { translate } from "../../i18n/i18n";
import { Button, Modal } from "@mono/ui";
import { useEffect, useState } from "react";
import { checkForUpdate, type PendingUpdate } from "../../infrastructure/updater";

/** The event fired by the "Check for updates now" button in Settings > About. Only AppUpdater listens for it. */
export const CHECK_UPDATE_EVENT = "mono:check-update";

type Phase = "idle" | "checking" | "available" | "downloading" | "ready" | "uptodate" | "error";

/**
 * Checks for an update once on startup and shows a modal if one is available. Clicking "Update now"
 * downloads, installs, and restarts. A manual check (CHECK_UPDATE_EVENT) opens the modal regardless of the result.
 * Outside Tauri, checkForUpdate returns null, so nothing is rendered.
 */
export function AppUpdater() {
  const [update, setUpdate] = useState<PendingUpdate | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  useEffect(() => {
    async function run(isManual: boolean) {
      setManual(isManual);
      setError(null);
      setPhase("checking");
      try {
        const found = await checkForUpdate();
        setUpdate(found);
        setPhase(found ? "available" : "uptodate");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setPhase("error");
      }
    }
    void run(false);
    const onManual = () => void run(true);
    window.addEventListener(CHECK_UPDATE_EVENT, onManual);
    return () => window.removeEventListener(CHECK_UPDATE_EVENT, onManual);
  }, []);

  async function install() {
    if (!update) return;
    setPhase("downloading");
    setProgress(0);
    setError(null);
    try {
      await update.downloadAndInstall((done, total) => {
        setProgress(total ? Math.round((done / total) * 100) : 0);
      });
      setPhase("ready");
      await update.relaunch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase("error");
    }
  }

  // The automatic check only shows up when an update is available (so a startup check failure doesn't bother the user).
  // An error after installation starts stays visible since an update exists. A manual check shows up regardless of the result.
  const open = phase === "available" || phase === "downloading" || phase === "ready"
    || (phase === "error" && (manual || update !== null))
    || (manual && (phase === "checking" || phase === "uptodate"));
  if (!open) return null;

  const dismissable = phase === "available" || phase === "uptodate" || phase === "error";

  return (
    <Modal icon="sparkles" onClose={() => { if (dismissable) setPhase("idle"); }} open title={translate("settings.about.update")}>
      <div className="app-updater">
        {phase === "checking" && <p role="status">{translate("updater.status.checking")}</p>}
        {phase === "uptodate" && <p role="status">{translate("updater.status.upToDate")}</p>}
        {phase === "error" && <p role="alert">{translate("updater.status.failed", { error: error ?? "" })}</p>}
        {update && (phase === "available" || phase === "downloading" || phase === "ready") && (
          <>
            <p>
              {translate("updater.status.available", { version: update.version, currentVersion: update.currentVersion })}
            </p>
            {update.notes && <pre className="app-updater__notes">{update.notes}</pre>}
            {phase === "downloading" && <p role="status">{translate("updater.status.downloading", { progress })}</p>}
            {phase === "ready" && <p role="status">{translate("updater.status.restarting")}</p>}
            {phase === "available" && (
              <div className="app-updater__actions">
                <Button onClick={() => setPhase("idle")} type="button">{translate("updater.action.later")}</Button>
                <Button onClick={() => void install()} type="button" variant="primary">{translate("updater.action.install")}</Button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
