import { Checkbox, Select } from "@mono/ui";
import { useState } from "react";
import { useI18n } from "../../i18n/i18n";
import {
  normalizeTimerSettings,
  TIMER_SETTINGS_EVENT,
  type TimerSettings,
  type TimerSettingsStore,
  type TimerTodoScope,
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
            <strong>{t("settings.timer.autoBreak.title")}</strong>
            <span>{t("settings.timer.autoBreak.description")}</span>
          </div>
          <Checkbox
            checked={settings.autoStartBreak}
            label={t("settings.timer.autoBreak.title")}
            onCheckedChange={(checked) => commit({ ...settings, autoStartBreak: checked })}
          />
        </div>
        <div className="settings-toggle-row timer-settings__row--divided">
          <div>
            <strong>{t("settings.timer.autoFocus.title")}</strong>
            <span>{t("settings.timer.autoFocus.description")}</span>
          </div>
          <Checkbox
            checked={settings.autoStartFocus}
            label={t("settings.timer.autoFocus.title")}
            onCheckedChange={(checked) => commit({ ...settings, autoStartFocus: checked })}
          />
        </div>
        <div className="settings-toggle-row timer-settings__row--divided">
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

      <section className="settings-group">
        <header>
          <strong>{t("settings.timer.scope.title")}</strong>
        </header>
        <div className="settings-locale-control">
          <Select
            label={t("settings.timer.scope.title")}
            onChange={(value) => commit({ ...settings, todoScope: value as TimerTodoScope })}
            options={[
              { value: "all", label: t("settings.timer.scope.all") },
              { value: "today", label: t("settings.timer.scope.today") },
            ]}
            value={settings.todoScope}
          />
        </div>
      </section>
    </>
  );
}
