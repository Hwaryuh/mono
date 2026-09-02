import { translate } from "../../i18n/i18n";
import { Button, Modal } from "@mono/ui";
import { useEffect, useState } from "react";
import { checkForUpdate, type PendingUpdate } from "../../infrastructure/updater";

/** 설정 > 정보의 "지금 업데이트 확인" 버튼이 쏘는 이벤트. AppUpdater 하나만 듣는다. */
export const CHECK_UPDATE_EVENT = "mono:check-update";

type Phase = "idle" | "checking" | "available" | "downloading" | "ready" | "uptodate" | "error";

/**
 * 시작 시 한 번 업데이트를 확인하고, 있으면 모달로 알린다. "지금 업데이트"를 누르면
 * 내려받아 설치하고 재시작한다. 수동 확인(CHECK_UPDATE_EVENT)은 결과와 무관하게 모달을 연다.
 * Tauri 밖에서는 checkForUpdate가 null을 반환하므로 아무것도 렌더하지 않는다.
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

  // 자동 확인은 업데이트가 있을 때만 뜬다(시작 시 확인 실패로 사용자를 귀찮게 하지 않는다).
  // 설치를 시작한 뒤의 오류는 update가 있으므로 계속 보인다. 수동 확인은 결과와 무관하게 뜬다.
  const open = phase === "available" || phase === "downloading" || phase === "ready"
    || (phase === "error" && (manual || update !== null))
    || (manual && (phase === "checking" || phase === "uptodate"));
  if (!open) return null;

  const dismissable = phase === "available" || phase === "uptodate" || phase === "error";

  return (
    <Modal icon="sparkles" onClose={() => { if (dismissable) setPhase("idle"); }} open title={translate("settings.about.update")}>
      <div className="app-updater">
        {phase === "checking" && <p role="status">{translate("updater.text.001")}</p>}
        {phase === "uptodate" && <p role="status">{translate("updater.text.002")}</p>}
        {phase === "error" && <p role="alert">{translate("updater.text.003", { error: error ?? "" })}</p>}
        {update && (phase === "available" || phase === "downloading" || phase === "ready") && (
          <>
            <p>
              {translate("updater.text.004", { version: update.version, currentVersion: update.currentVersion })}
            </p>
            {update.notes && <pre className="app-updater__notes">{update.notes}</pre>}
            {phase === "downloading" && <p role="status">{translate("updater.text.006", { progress })}</p>}
            {phase === "ready" && <p role="status">{translate("updater.text.007")}</p>}
            {phase === "available" && (
              <div className="app-updater__actions">
                <Button onClick={() => setPhase("idle")} type="button">{translate("updater.text.008")}</Button>
                <Button onClick={() => void install()} type="button" variant="primary">{translate("updater.text.009")}</Button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
