import { Button, Input } from "@mono/ui";
import { useEffect, useState } from "react";
import { formatTimestamp } from "@mono/domain";
import { formatMediaSize } from "../dashboard/QuickCapture";
import { R2_FREE_CLASS_A, R2_FREE_CLASS_B, R2_FREE_STORAGE_BYTES, type MediaMaintenance, type OrphanMediaUsage } from "../../infrastructure/media/media-maintenance";
import { type R2SettingsStore, type R2UsageReport } from "../../infrastructure/media/r2-settings-store";
import { translate } from "../../i18n/i18n";
import { messageOf, SettingsHeading, useAsyncAction } from "./settings-shared";

/**
 * 미사용 미디어 정리. R2 참조 여부는 서버가 자체 DB(수집함·스크랩)로 계산하므로 클라이언트는
 * 확인·정리 버튼만 누르면 된다 — keepIds를 직접 모아 넘기던 예전 방식은 없앴다.
 */
export function StorageSettingsPanel({ mediaMaintenance }: { mediaMaintenance: MediaMaintenance }) {
  const [usage, setUsage] = useState<OrphanMediaUsage | null>(null);
  const { pending, message, error, setMessage, run } = useAsyncAction<"scan" | "clean">();

  return (
    <>
      <SettingsHeading description={translate("settings.storage.description")} title={translate("settings.section.storage")} />
      <section aria-label={translate("settings.storage.cleanupTitle")} className="settings-group settings-ai">
        <header>
          <strong>{translate("settings.storage.unusedMedia")}</strong>
          <span>{translate("settings.storage.unusedMediaDescription")}</span>
        </header>
        {usage !== null && usage.totalCount > 0 && (
          <div className="settings-ai__status">
            <span>{translate("settings.storage.totalUsage")}</span>
            <strong>{translate("settings.storage.totalUsageSummary", {
              size: formatMediaSize(usage.totalBytes),
              limit: formatMediaSize(R2_FREE_STORAGE_BYTES),
              percent: Math.round((usage.totalBytes / R2_FREE_STORAGE_BYTES) * 100),
              count: usage.totalCount,
            })}</strong>
          </div>
        )}
        {usage !== null && usage.totalCount > 0 && usage.totalBytes >= R2_FREE_STORAGE_BYTES * 0.8 && (
          <p className="settings-ai__error" role="alert">
            {translate("settings.storage.limitWarning", { percent: Math.round((usage.totalBytes / R2_FREE_STORAGE_BYTES) * 100) })}
          </p>
        )}
        <div className="settings-ai__status">
          <span>{translate("settings.storage.cleanupTarget")}</span>
          <strong>
            {usage === null ? translate("common.status.needsCheck") : usage.count === 0 ? translate("common.none") : translate("settings.storage.usageSummary", { count: usage.count, size: formatMediaSize(usage.bytes) })}
          </strong>
          <Button loading={pending === "scan"} onClick={() => void run("scan", async () => {
            const scanned = await mediaMaintenance.orphanUsage();
            setUsage(scanned);
            if (scanned.count === 0) setMessage(translate("settings.storage.cleanupEmpty"));
          })} type="button">{translate("common.action.check")}</Button>
          <Button
            disabled={!usage || usage.count === 0}
            loading={pending === "clean"}
            onClick={() => void run("clean", async () => {
              const deleted = await mediaMaintenance.gc();
              setUsage((prev) => prev ? { ...prev, count: 0, bytes: 0, totalCount: prev.totalCount - prev.count, totalBytes: prev.totalBytes - prev.bytes } : prev);
              setMessage(translate("settings.storage.cleanupResult", { count: deleted }));
            })}
            type="button"
            variant="danger"
          >
            {translate("common.action.clean")}</Button>
        </div>
        {message && <p className="settings-ai__message" role="status">{message}</p>}
        {error && <p className="settings-ai__error" role="alert">{error}</p>}
        <p className="settings-ai__notice-text">{translate("common.warning.irreversibleDelete")}</p>
      </section>
    </>
  );
}

export function R2CredentialsSection({ store }: { store: R2SettingsStore }) {
  const [accountId, setAccountId] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [bucket, setBucket] = useState("");
  const [hasCredentials, setHasCredentials] = useState<boolean | null>(null);
  const { pending, message, error, setMessage, setError, run } = useAsyncAction<"save" | "test" | "delete">();

  useEffect(() => {
    let active = true;
    store.hasCredentials()
      .then((configured) => { if (active) setHasCredentials(configured); })
      .catch((cause: unknown) => { if (active) setError(messageOf(cause)); });
    return () => { active = false; };
  }, [store, setError]);

  const canSave = accountId.trim().length > 0 && accessKeyId.trim().length > 0 && secretAccessKey.trim().length > 0 && bucket.trim().length > 0;

  return (
    <section aria-label={translate("settings.r2.title")} className="settings-group settings-ai">
      <header>
        <strong>Cloudflare R2</strong>
        <span>{translate("settings.r2.description")}</span>
      </header>
      <form onSubmit={(event) => {
        event.preventDefault();
        void run("save", async () => {
          await store.setCredentials({ accountId, accessKeyId, secretAccessKey, bucket });
          setAccountId("");
          setAccessKeyId("");
          setSecretAccessKey("");
          setBucket("");
          setHasCredentials(true);
          setMessage(translate("settings.r2.saved"));
        });
      }}>
        <Input aria-label={translate("settings.r2.accountId")} autoComplete="off" onChange={(event) => setAccountId(event.target.value)} placeholder={translate("settings.r2.accountId")} value={accountId} />
        <Input aria-label={translate("settings.r2.accessKeyId")} autoComplete="off" onChange={(event) => setAccessKeyId(event.target.value)} placeholder={translate("settings.r2.accessKeyId")} type="password" value={accessKeyId} />
        <Input aria-label={translate("settings.r2.secretAccessKey")} autoComplete="off" onChange={(event) => setSecretAccessKey(event.target.value)} placeholder={translate("settings.r2.secretAccessKey")} type="password" value={secretAccessKey} />
        <Input aria-label={translate("settings.r2.bucketName")} autoComplete="off" onChange={(event) => setBucket(event.target.value)} placeholder={translate("settings.r2.bucketName")} value={bucket} />
        <Button disabled={!canSave} loading={pending === "save"} type="submit" variant="primary">{translate("common.action.save")}</Button>
      </form>
      <div className="settings-ai__status">
        <span>{translate("common.status.label")}</span>
        <strong>{hasCredentials === null ? translate("common.status.checking") : hasCredentials ? translate("common.status.configured") : translate("common.status.notConfigured")}</strong>
        <Button disabled={!hasCredentials} loading={pending === "test"} onClick={() => void run("test", async () => {
          await store.testConnection();
          setMessage(translate("settings.r2.connectionSuccess"));
        })} type="button">{translate("common.action.testConnection")}</Button>
        <Button disabled={!hasCredentials} loading={pending === "delete"} onClick={() => void run("delete", async () => {
          await store.deleteCredentials();
          setHasCredentials(false);
          setMessage(translate("settings.r2.deleted"));
        })} type="button">{translate("common.action.delete")}</Button>
      </div>
      {message && <p className="settings-ai__message" role="status">{message}</p>}
      {error && <p className="settings-ai__error" role="alert">{error}</p>}
    </section>
  );
}

function usagePercent(value: number, limit: number) {
  return Math.round((value / limit) * 100);
}

/** Cloudflare Analytics 토큰으로 청구 기준 저장량 + 이번 달 Class A/B op를 무료 한도 대비 표시. */
export function R2UsageSection({ store }: { store: R2SettingsStore }) {
  const [token, setToken] = useState("");
  const [hasToken, setHasToken] = useState<boolean | null>(null);
  const [report, setReport] = useState<R2UsageReport | null>(null);
  const { pending, message, error, setMessage, setError, run } = useAsyncAction<"save" | "load" | "delete">();

  useEffect(() => {
    let active = true;
    store.hasAnalyticsToken()
      .then((configured) => { if (active) setHasToken(configured); })
      .catch((cause: unknown) => { if (active) setError(messageOf(cause)); });
    return () => { active = false; };
  }, [store, setError]);

  const rows: Array<{ label: string; value: string; percent: number }> = report ? [
    { label: translate("settings.storage.totalUsage"), value: `${formatMediaSize(report.storageBytes)} / ${formatMediaSize(R2_FREE_STORAGE_BYTES)}`, percent: usagePercent(report.storageBytes, R2_FREE_STORAGE_BYTES) },
    { label: translate("settings.r2usage.classA"), value: `${report.classA.toLocaleString("ko-KR")} / ${R2_FREE_CLASS_A.toLocaleString("ko-KR")}`, percent: usagePercent(report.classA, R2_FREE_CLASS_A) },
    { label: translate("settings.r2usage.classB"), value: `${report.classB.toLocaleString("ko-KR")} / ${R2_FREE_CLASS_B.toLocaleString("ko-KR")}`, percent: usagePercent(report.classB, R2_FREE_CLASS_B) },
  ] : [];
  const overLimit = rows.filter((row) => row.percent >= 80);

  return (
    <section aria-label={translate("settings.r2usage.title")} className="settings-group settings-ai">
      <header>
        <strong>{translate("settings.r2usage.title")}</strong>
        <span>{translate("settings.r2usage.description")}</span>
      </header>
      <form onSubmit={(event) => {
        event.preventDefault();
        void run("save", async () => {
          await store.setAnalyticsToken(token);
          setToken("");
          setHasToken(true);
          setMessage(translate("settings.r2usage.tokenSaved"));
        });
      }}>
        <Input aria-label={translate("settings.r2usage.tokenLabel")} autoComplete="off" onChange={(event) => setToken(event.target.value)} placeholder={translate("settings.r2usage.tokenLabel")} type="password" value={token} />
        <Button disabled={token.trim().length === 0} loading={pending === "save"} type="submit" variant="primary">{translate("common.action.save")}</Button>
      </form>
      <div className="settings-ai__status">
        <span>{translate("common.status.label")}</span>
        <strong>{hasToken === null ? translate("common.status.checking") : hasToken ? translate("common.status.configured") : translate("common.status.notConfigured")}</strong>
        <Button disabled={!hasToken} loading={pending === "load"} onClick={() => void run("load", async () => {
          setReport(await store.usageReport());
        })} type="button">{translate("common.action.check")}</Button>
        <Button disabled={!hasToken} loading={pending === "delete"} onClick={() => void run("delete", async () => {
          await store.deleteAnalyticsToken();
          setHasToken(false);
          setReport(null);
          setMessage(translate("settings.r2usage.tokenDeleted"));
        })} type="button">{translate("common.action.delete")}</Button>
      </div>
      {rows.map((row) => (
        <div className="settings-ai__status" key={row.label}>
          <span>{row.label}</span>
          <strong>{translate("settings.r2usage.metricValue", { value: row.value, percent: row.percent })}</strong>
        </div>
      ))}
      {report && report.otherOps > 0 && (
        <p className="settings-ai__notice-text">{translate("settings.r2usage.otherOps", { count: report.otherOps.toLocaleString("ko-KR") })}</p>
      )}
      {overLimit.length > 0 && (
        <p className="settings-ai__error" role="alert">
          {translate("settings.r2usage.limitWarning", { names: overLimit.map((row) => row.label).join(", ") })}
        </p>
      )}
      {report?.sampledAt && (
        <p className="settings-ai__notice-text">{translate("settings.r2usage.sampledAt", { time: formatTimestamp(report.sampledAt) })}</p>
      )}
      {message && <p className="settings-ai__message" role="status">{message}</p>}
      {error && <p className="settings-ai__error" role="alert">{error}</p>}
    </section>
  );
}
