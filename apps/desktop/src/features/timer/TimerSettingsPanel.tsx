import { Checkbox, Input, Select } from "@mono/ui";
import { useState } from "react";
import { useI18n } from "../../i18n/i18n";
import {
  normalizeTimerSettings,
  timerCycleBounds,
  timerMinuteBounds,
  TIMER_SETTINGS_EVENT,
  type TimerSettings,
  type TimerSettingsStore,
  type TimerTodoScope,
} from "./timer-settings-store";

/** 입력 중 빈 칸을 허용하려고 원본 문자열을 따로 들고 있다가, 저장할 때만 숫자로 좁힌다. */
type Drafts = Partial<Record<keyof TimerSettings, string>>;

export function TimerSettingsPanel({ store }: { store: TimerSettingsStore }) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<TimerSettings>(() => store.read());
  const [drafts, setDrafts] = useState<Drafts>({});

  function commit(next: TimerSettings) {
    const normalized = normalizeTimerSettings(next);
    setSettings(normalized);
    store.write(normalized);
    window.dispatchEvent(new Event(TIMER_SETTINGS_EVENT));
  }

  function numberField(key: "focusMinutes" | "shortBreakMinutes" | "longBreakMinutes" | "longBreakEvery", labelKey: Parameters<typeof t>[0], bounds: { min: number; max: number }) {
    return (
      <label className="timer-settings__field">
        <span>{t(labelKey)}</span>
        <Input
          inputMode="numeric"
          max={bounds.max}
          min={bounds.min}
          onBlur={() => {
            setDrafts((current) => ({ ...current, [key]: undefined }));
            commit({ ...settings, [key]: Number(drafts[key] ?? settings[key]) });
          }}
          onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
          type="number"
          value={drafts[key] ?? String(settings[key])}
        />
      </label>
    );
  }

  return (
    <>
      <div className="settings-heading">
        <strong>{t("settings.section.timer")}</strong>
        <p>{t("settings.timer.description")}</p>
      </div>

      <section className="settings-group">
        <header>
          <strong>{t("settings.timer.length.title")}</strong>
          <span>{t("settings.timer.length.description")}</span>
        </header>
        <div className="timer-settings__lengths">
          {numberField("focusMinutes", "settings.timer.focus", timerMinuteBounds)}
          {numberField("shortBreakMinutes", "settings.timer.shortBreak", timerMinuteBounds)}
          {numberField("longBreakMinutes", "settings.timer.longBreak", timerMinuteBounds)}
          {numberField("longBreakEvery", "settings.timer.longBreakEvery", timerCycleBounds)}
        </div>
      </section>

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
      </section>

      <section className="settings-group">
        <header>
          <strong>{t("settings.timer.scope.title")}</strong>
          <span>{t("settings.timer.scope.description")}</span>
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
          <p>{t("settings.timer.scope.hint")}</p>
        </div>
      </section>
    </>
  );
}
