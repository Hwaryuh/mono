import { Button, Input } from "@mono/ui";
import { useEffect, useState } from "react";
import { httpDelete, httpGet, httpPost } from "../../infrastructure/http/http-client";
import { translate } from "../../i18n/i18n";
import { messageOf, useAsyncAction } from "./settings-shared";

interface DiscordConfig { hasToken: boolean; channelId: string | null }

/** Messages posted in the chosen Discord channel are polled by the server and land in the inbox like quick captures. */
export function DiscordSettingsSection() {
  const [config, setConfig] = useState<DiscordConfig | null>(null);
  const [token, setToken] = useState("");
  const [channelId, setChannelId] = useState("");
  const { pending, message, error, setMessage, setError, run } = useAsyncAction<"save" | "delete">();

  useEffect(() => {
    let active = true;
    httpGet<DiscordConfig>("/discord/config")
      .then((loaded) => {
        if (!active) return;
        setConfig(loaded);
        setChannelId(loaded.channelId ?? "");
      })
      .catch((cause: unknown) => { if (active) setError(messageOf(cause)); });
    return () => { active = false; };
  }, [setError]);

  const connected = config?.hasToken && config.channelId;

  return (
    <section aria-label={translate("settings.discord.title")} className="settings-group settings-ai">
      <header>
        <strong>{translate("settings.discord.title")}</strong>
        <span>{translate("settings.discord.description")}</span>
      </header>
      <div className="settings-ai__body">
        <form onSubmit={(event) => {
          event.preventDefault();
          void run("save", async () => {
            await httpPost("/discord/config", { token, channelId });
            setToken("");
            setConfig({ hasToken: true, channelId: channelId.trim() });
            setMessage(translate("settings.discord.saved"));
          });
        }}>
          <Input
            aria-label={translate("settings.discord.tokenLabel")}
            autoComplete="off"
            onChange={(event) => setToken(event.target.value)}
            placeholder={config?.hasToken ? translate("settings.ai.replaceKey") : translate("settings.discord.tokenPlaceholder")}
            type="password"
            value={token}
          />
          <Input
            aria-label={translate("settings.discord.channelLabel")}
            inputMode="numeric"
            onChange={(event) => setChannelId(event.target.value)}
            placeholder={translate("settings.discord.channelPlaceholder")}
            value={channelId}
          />
          <Button disabled={!channelId.trim() || (!token.trim() && !config?.hasToken)} loading={pending === "save"} type="submit" variant="primary">{translate("common.action.save")}</Button>
        </form>
        <div className="settings-ai__status">
          <span>{translate("common.status.label")}</span>
          <strong>{config === null ? translate("common.status.checking") : connected ? translate("settings.discord.connected") : translate("settings.discord.notConnected")}</strong>
          <Button disabled={!config?.hasToken} loading={pending === "delete"} onClick={() => void run("delete", async () => {
            await httpDelete("/discord/config");
            setConfig({ hasToken: false, channelId: null });
            setChannelId("");
            setMessage(translate("settings.discord.deleted"));
          })} type="button">{translate("common.action.delete")}</Button>
        </div>
        {message && <p className="settings-ai__message" role="status">{message}</p>}
        {error && <p className="settings-ai__error" role="alert">{error}</p>}
        <p className="settings-ai__notice-text">{translate("settings.discord.notice")}</p>
      </div>
    </section>
  );
}
