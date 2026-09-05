import { Button, Input, StatusIndicator } from "@mono/ui";
import { useEffect, useState } from "react";
import {
  looksLikeRemoteApiUrl,
  trimBaseUrl,
  type ServerConnection,
  type ServerMode,
  type ServerSettingsStore,
} from "../../infrastructure/server/server-settings-store";
import { translate } from "../../i18n/i18n";
import { messageOf, SettingsHeading } from "./settings-shared";

const SERVER_MODE_OPTIONS: { id: ServerMode; label: string; description: string }[] = [
  { id: "embedded", label: translate("settings.server.localMode"), description: translate("settings.server.localModeDescription") },
  { id: "remote", label: translate("settings.server.remoteMode"), description: translate("settings.server.remoteModeDescription") },
];

type CurrentConnectionStatus = { state: "checking" } | { state: "online" } | { state: "offline"; detail: string };

function CurrentConnectionBadge({ status }: { status: CurrentConnectionStatus }) {
  if (status.state === "online") return <StatusIndicator icon="check" label={translate("settings.server.connected")} tone="success" />;
  if (status.state === "offline") return <StatusIndicator icon="alert" label={translate("settings.server.unreachable")} tone="danger" />;
  return <StatusIndicator icon="sync" label={translate("common.status.checking")} tone="neutral" />;
}

/**
 * Decides which mono API server this device uses. The setting is stored in server.json and takes effect
 * starting from the next launch — lib.rs decides the connection only once, at startup. That's why "Save" and "Restart"
 * are separate, with restartRequired surfacing any mismatch between the two.
 */
export function ServerSettingsPanel({ store }: { store: ServerSettingsStore }) {
  const [connection, setConnection] = useState<ServerConnection | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draftMode, setDraftMode] = useState<ServerMode>("embedded");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftToken, setDraftToken] = useState("");
  const [current, setCurrent] = useState<CurrentConnectionStatus>({ state: "checking" });
  const [pending, setPending] = useState<"save" | "test" | "restart" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  function applyConnection(next: ServerConnection) {
    setConnection(next);
    setDraftMode(next.mode);
    setDraftUrl(next.remoteUrl);
    setDraftToken(next.remoteToken);
  }

  useEffect(() => {
    let active = true;
    store.read()
      .then((next) => { if (active) applyConnection(next); })
      .catch((cause: unknown) => { if (active) setLoadError(messageOf(cause)); });
    return () => { active = false; };
  }, [store]);

  const effectiveApiBaseUrl = connection?.effectiveApiBaseUrl;
  // For a remote connection, the probe must use the stored token — otherwise a server that requires a token
  // shows as "no response" because the auth endpoint returns 401, even though it's actually fine. Embedded mode has no token.
  const effectiveToken = connection && !connection.runningEmbedded
    ? connection.remoteToken || undefined
    : undefined;
  useEffect(() => {
    if (!effectiveApiBaseUrl) return;
    let active = true;
    setCurrent({ state: "checking" });
    store.probe(effectiveApiBaseUrl, effectiveToken)
      .then(() => { if (active) setCurrent({ state: "online" }); })
      .catch((cause: unknown) => { if (active) setCurrent({ state: "offline", detail: messageOf(cause) }); });
    return () => { active = false; };
  }, [store, effectiveApiBaseUrl, effectiveToken]);

  const dirty = Boolean(connection) && (
    draftMode !== connection?.mode
    || (draftMode === "remote" && trimBaseUrl(draftUrl) !== connection?.remoteUrl)
    || (draftMode === "remote" && draftToken.trim() !== connection?.remoteToken)
  );
  const draftUrlValid = draftMode === "embedded" || looksLikeRemoteApiUrl(draftUrl);
  const canSave = Boolean(connection?.manageable) && dirty && draftUrlValid && pending === null;

  async function save() {
    setPending("save");
    setMessage(null);
    setError(null);
    try {
      const next = await store.save({ mode: draftMode, remoteUrl: draftUrl, token: draftToken });
      applyConnection(next);
      setTestResult(null);
      setMessage(next.restartRequired ? translate("settings.server.savedRestartRequired") : translate("settings.server.savedApplied"));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(null);
    }
  }

  async function testConnection() {
    setPending("test");
    setMessage(null);
    setError(null);
    setTestResult(null);
    try {
      await store.probe(trimBaseUrl(draftUrl), draftToken.trim() || undefined);
      setTestResult({ ok: true, text: translate("settings.server.connectionSuccess") });
    } catch (cause) {
      setTestResult({ ok: false, text: messageOf(cause) });
    } finally {
      setPending(null);
    }
  }

  async function restart() {
    setPending("restart");
    setError(null);
    try {
      await store.restart();
    } catch (cause) {
      setError(messageOf(cause));
      setPending(null);
    }
  }

  return (
    <>
      <SettingsHeading description={translate("settings.server.description")} title={translate("settings.server.title")} />

      {loadError && <p className="settings-ai__error" role="alert">{loadError}</p>}

      {connection && (
        <>
          <section aria-label={translate("settings.server.title")} className="settings-group">
            <div className="settings-server__status">
              <span className={`settings-server__tag ${connection.runningEmbedded ? "" : "settings-server__tag--remote"}`}>
                {connection.runningEmbedded ? translate("settings.server.localMode") : translate("settings.server.remoteMode")}
              </span>
              <CurrentConnectionBadge status={current} />
              {(connection.envOverride || connection.restartRequired) && (
                <code className="settings-server__url" title={connection.effectiveApiBaseUrl}>{connection.effectiveApiBaseUrl}</code>
              )}
            </div>
            {current.state === "offline" && <p className="settings-server__status-detail" role="alert">{current.detail}</p>}
            {connection.envOverride && (
              <p className="settings-server__status-detail">
                {translate("settings.server.environmentOverride", { variable: "MONO_API_BASE_URL" })}</p>
            )}

            <div aria-label={translate("settings.server.modeLabel")} className="settings-server__modes" role="radiogroup">
              {SERVER_MODE_OPTIONS.map((option) => (
                <button
                  aria-checked={draftMode === option.id}
                  className="settings-server__mode"
                  disabled={!connection.manageable || pending !== null}
                  key={option.id}
                  onClick={() => { setDraftMode(option.id); setMessage(null); setError(null); }}
                  role="radio"
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="settings-server__mode-hint">
              {SERVER_MODE_OPTIONS.find((option) => option.id === draftMode)?.description}
            </p>

            {draftMode === "remote" && (
              <div className="settings-server__remote">
                <form onSubmit={(event) => { event.preventDefault(); void testConnection(); }}>
                  <Input
                    aria-label={translate("settings.server.remoteUrl")}
                    autoComplete="off"
                    disabled={!connection.manageable}
                    invalid={draftUrl.trim().length > 0 && !draftUrlValid}
                    inputMode="url"
                    onChange={(event) => { setDraftUrl(event.target.value); setTestResult(null); }}
                    placeholder="https://mono.example.com"
                    spellCheck={false}
                    value={draftUrl}
                  />
                  <Button disabled={!looksLikeRemoteApiUrl(draftUrl) || pending !== null} loading={pending === "test"} type="submit">
                    {translate("common.action.testConnection")}</Button>
                </form>
                <Input
                  aria-label={translate("settings.server.apiToken")}
                  autoComplete="off"
                  disabled={!connection.manageable}
                  onChange={(event) => { setDraftToken(event.target.value); setTestResult(null); }}
                  placeholder={translate("settings.server.apiTokenOptional")}
                  spellCheck={false}
                  type="password"
                  value={draftToken}
                />
                <p className="settings-server__hint">
                  {translate("settings.server.connectionHint", { variable: "MONO_API_TOKEN" })}</p>
                {testResult && (
                  <p
                    className={testResult.ok ? "settings-ai__message" : "settings-ai__error"}
                    role={testResult.ok ? "status" : "alert"}
                  >
                    {testResult.text}
                  </p>
                )}
              </div>
            )}

            <div className="settings-server__actions">
              <Button disabled={!canSave} loading={pending === "save"} onClick={() => void save()} type="button" variant="primary">{translate("common.action.save")}</Button>
            </div>

            {message && <p className="settings-ai__message" role="status">{message}</p>}
            {error && <p className="settings-ai__error" role="alert">{error}</p>}
          </section>

          {connection.restartRequired && (
            <section aria-label={translate("settings.server.restartNotice")} className="settings-server__restart">
              <div>
                <strong>{translate("settings.server.restartRequired")}</strong>
                <span>{translate("settings.server.restartDescription")}</span>
              </div>
              <Button loading={pending === "restart"} onClick={() => void restart()} type="button" variant="primary">{translate("settings.server.restartNow")}</Button>
            </section>
          )}
        </>
      )}
    </>
  );
}
