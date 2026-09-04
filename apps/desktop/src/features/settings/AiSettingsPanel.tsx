import { Button, Input } from "@mono/ui";
import { useEffect, useState } from "react";
import { type AiProviderId, type AiSettingsStore } from "../../infrastructure/ai/ai-settings-store";
import { translate } from "../../i18n/i18n";
import { messageOf, SettingsHeading, useAsyncAction } from "./settings-shared";

const providerMeta: Record<AiProviderId, { label: string; keyPlaceholder: string; keySource: string; dataNotice: string; model: string }> = {
  gemini: {
    label: "Gemini",
    keyPlaceholder: translate("settings.ai.geminiTitle"),
    keySource: "Google AI Studio",
    dataNotice: translate("settings.ai.geminiDescription"),
    model: "gemini-2.5-flash-lite",
  },
  openai: {
    label: "OpenAI",
    keyPlaceholder: translate("settings.ai.openaiTitle"),
    keySource: "OpenAI Platform",
    dataNotice: translate("settings.ai.openaiDescription"),
    model: "gpt-5-nano",
  },
};

export function AiSettingsPanel({ store }: { store: AiSettingsStore }) {
  const [activeProvider, setActiveProviderState] = useState<AiProviderId | null>(null);
  const [providerPending, setProviderPending] = useState(false);
  const [providerError, setProviderError] = useState<{ provider: AiProviderId | null; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    store.getActiveProvider()
      .then((provider) => { if (active) setActiveProviderState(provider); })
      .catch((cause: unknown) => { if (active) setProviderError({ provider: null, message: messageOf(cause) }); });
    return () => { active = false; };
  }, [store]);

  async function selectProvider(provider: AiProviderId) {
    setProviderPending(true);
    setProviderError(null);
    try {
      await store.setActiveProvider(provider);
      setActiveProviderState(provider);
    } catch (cause) {
      setProviderError({ provider, message: messageOf(cause) });
    } finally {
      setProviderPending(false);
    }
  }

  return (
    <>
      <SettingsHeading description={translate("settings.ai.description")} title="AI" />
      {providerError?.provider === null && <p className="settings-ai__error settings-ai__provider-error" role="alert">{providerError.message}</p>}
      <div aria-label={translate("settings.ai.providerLabel")} className="settings-ai-providers" role="radiogroup">
        {(Object.keys(providerMeta) as AiProviderId[]).map((provider) => (
          <ApiKeySection
            active={activeProvider === provider}
            key={provider}
            onSelect={() => void selectProvider(provider)}
            provider={provider}
            providerPending={providerPending}
            selectionError={providerError?.provider === provider ? providerError.message : null}
            store={store}
          />
        ))}
      </div>
    </>
  );
}

function ApiKeySection({ active, onSelect, provider, providerPending, selectionError, store }: {
  active: boolean;
  onSelect: () => void;
  provider: AiProviderId;
  providerPending: boolean;
  selectionError: string | null;
  store: AiSettingsStore;
}) {
  const meta = providerMeta[provider];
  const [apiKey, setApiKey] = useState("");
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const { pending, message, error, setMessage, setError, run } = useAsyncAction<"save" | "test" | "delete">();

  useEffect(() => {
    let active = true;
    store.hasApiKey(provider)
      .then((configured) => { if (active) setHasKey(configured); })
      .catch((cause: unknown) => { if (active) setError(messageOf(cause)); });
    return () => { active = false; };
  }, [provider, store, setError]);

  return (
    <section aria-label={translate("settings.ai.keySectionLabel", { provider: meta.label })} className={`settings-group settings-ai settings-ai--provider ${active ? "settings-ai--active" : "settings-ai--inactive"}`}>
      <header className="settings-ai__provider-header">
        <label>
          <input checked={active} disabled={providerPending} name="active-ai-provider" onChange={onSelect} type="radio" />
          <span className="settings-ai__provider-title"><strong>{translate("settings.ai.keyTitle", { provider: meta.label })}</strong><small>{meta.model}</small></span>
        </label>
        <span>{translate("settings.ai.keySecurityDescription")}</span>
      </header>
      <div className="settings-ai__body">
        <form onSubmit={(event) => {
          event.preventDefault();
          void run("save", async () => {
            await store.setApiKey(provider, apiKey);
            setApiKey("");
            setHasKey(true);
            setMessage(translate("settings.ai.keySaved"));
          });
        }}>
          <Input
            aria-label={translate("settings.ai.keyLabel", { provider: meta.label })}
            autoComplete="off"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={hasKey ? translate("settings.ai.replaceKey") : meta.keyPlaceholder}
            type="password"
            value={apiKey}
          />
          <Button disabled={!apiKey.trim()} loading={pending === "save"} type="submit" variant="primary">{translate("common.action.save")}</Button>
        </form>
        <div className="settings-ai__status">
          <span>{translate("common.status.label")}</span>
          <strong>{hasKey === null ? translate("common.status.checking") : hasKey ? translate("settings.ai.keyConfigured") : translate("settings.ai.keyMissing")}</strong>
          <Button disabled={!hasKey} loading={pending === "test"} onClick={() => void run("test", async () => {
            await store.testConnection(provider);
            setMessage(translate("settings.ai.connectionSuccess", { provider: meta.label }));
          })} type="button">{translate("common.action.testConnection")}</Button>
          <Button disabled={!hasKey} loading={pending === "delete"} onClick={() => void run("delete", async () => {
            await store.deleteApiKey(provider);
            setHasKey(false);
            setMessage(translate("settings.ai.keyDeleted"));
          })} type="button">{translate("common.action.delete")}</Button>
        </div>
        {selectionError && <p className="settings-ai__error" role="alert">{selectionError}</p>}
        {message && <p className="settings-ai__message" role="status">{message}</p>}
        {error && <p className="settings-ai__error" role="alert">{error}</p>}
        <p className="settings-ai__notice-text">{meta.dataNotice}</p>
      </div>
    </section>
  );
}
