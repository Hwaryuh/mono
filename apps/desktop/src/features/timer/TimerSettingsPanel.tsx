import { Checkbox } from "@mono/ui";
import { useState } from "react";
import { useI18n } from "../../i18n/i18n";
import {
  normalizeTimerSettings,
  TIMER_SETTINGS_EVENT,
  type TimerSettings,
  type TimerSettingsStore,
} from "./timer-settings-store";

export function TimerSettingsPanel({ store }: { store: TimerSettingsStore }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<TimerSettings>(() => store.read());

  function commit(next: TimerSettings) {
    const normalized = normalizeTimerSettings(next);
    setSettings(normalized);
    store.write(normalized);
    window.dispatchEvent(new Event(TIMER_SETTINGS_EVENT));
  }

  return (
    <>
      <header className="settings-heading">
        <strong>{t("settings.section.timer")}</strong>
        <p>{t("settings.timer.description")}</p>
      </header>

      <section className="settings-group">
        <header><strong>{t("settings.timer.flow.title")}</strong></header>
        <div className="settings-toggle-row">
          <div>
            <strong>{t("settings.timer.alarm.title")}</strong>
            <span>{t("settings.timer.alarm.description")}</span>
          </div>
          <Checkbox
            checked={settings.alarmEnabled}
            label={t("settings.timer.alarm.title")}
            onCheckedChange={(checked) => commit({ ...settings, alarmEnabled: checked })}
          />
        </div>
      </section>
    </>
  );
}
