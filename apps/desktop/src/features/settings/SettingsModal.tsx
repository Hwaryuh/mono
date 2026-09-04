import { Button, ColorPicker, Icon, Modal, Select, type IconName } from "@mono/ui";
import { Fragment, useState } from "react";
import { localeOptions, useI18n, type Locale } from "../../i18n/i18n";
import type { TranslationKey } from "../../i18n/messages.ko";
import { TimerSettingsPanel } from "../timer/TimerSettingsPanel";
import { LocalStorageTimerSettingsStore } from "../timer/timer-settings-store";
import { CHECK_UPDATE_EVENT } from "../updater/AppUpdater";
import type { AiSettingsStore } from "../../infrastructure/ai/ai-settings-store";
import type { MediaMaintenance } from "../../infrastructure/media/media-maintenance";
import type { R2SettingsStore } from "../../infrastructure/media/r2-settings-store";
import type { ServerSettingsStore } from "../../infrastructure/server/server-settings-store";
import { SettingsHeading } from "./settings-shared";
import { AiSettingsPanel } from "./AiSettingsPanel";
import { ServerSettingsPanel } from "./ServerSettingsPanel";
import { R2CredentialsSection, R2UsageSection, StorageSettingsPanel } from "./StorageSettingsPanel";

export type Theme = "light" | "dark";
type SettingsSectionId = "appearance" | "timer" | "server" | "ai" | "storage" | "about";

interface SettingsSectionDefinition {
  id: SettingsSectionId;
  labelKey: TranslationKey;
  icon: IconName;
  groupKey: TranslationKey;
}

const settingsSections: SettingsSectionDefinition[] = [
  { id: "appearance", labelKey: "settings.section.appearance", icon: "sun", groupKey: "settings.group.appearance" },
  { id: "server", labelKey: "settings.section.server", icon: "server", groupKey: "settings.group.connection" },
  { id: "ai", labelKey: "settings.section.ai", icon: "sparkles", groupKey: "settings.group.connection" },
  { id: "storage", labelKey: "settings.section.storage", icon: "layers", groupKey: "settings.group.connection" },
  { id: "timer", labelKey: "settings.section.timer", icon: "clock", groupKey: "settings.group.module" },
  { id: "about", labelKey: "settings.section.about", icon: "note", groupKey: "settings.group.etc" },
];

const timerSettingsStore = LocalStorageTimerSettingsStore.of(window.localStorage);

export function SettingsModal({ open, onClose, theme, onThemeChange, accentColor, onAccentColorChange, locale, onLocaleChange, aiSettingsStore, mediaMaintenance, r2SettingsStore, serverSettingsStore }: {
  open: boolean;
  onClose: () => void;
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  accentColor: string;
  onAccentColorChange: (accentColor: string) => void;
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  aiSettingsStore: AiSettingsStore;
  mediaMaintenance: MediaMaintenance;
  r2SettingsStore: R2SettingsStore;
  serverSettingsStore: ServerSettingsStore;
}) {
  const { t } = useI18n();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("appearance");
  return (
    <Modal className="settings-modal" icon="settings" onClose={onClose} open={open} title={t("settings.title")}>
      <div className="settings-layout">
        <aside className="settings-navigation">
          <nav aria-label={t("settings.navigation")}>
            {settingsSections.map((section, index) => (
              <Fragment key={section.id}>
                {section.groupKey !== settingsSections[index - 1]?.groupKey && (
                  <span className="settings-navigation__group">{t(section.groupKey)}</span>
                )}
                <button
                  aria-current={activeSection === section.id ? "page" : undefined}
                  className={activeSection === section.id ? "settings-navigation__item settings-navigation__item--active" : "settings-navigation__item"}
                  onClick={() => setActiveSection(section.id)}
                  type="button"
                >
                  <Icon name={section.icon} size={14} />
                  <span>{t(section.labelKey)}</span>
                </button>
              </Fragment>
            ))}
          </nav>
        </aside>

        <section className="settings-content">
          {activeSection === "appearance" && (
            <>
              <SettingsHeading description={t("settings.appearance.description")} title={t("settings.section.appearance")} />
              <section className="settings-group">
                <header><strong>{t("settings.theme.title")}</strong><span>{t("settings.theme.description")}</span></header>
                <div aria-label={t("settings.theme.label")} className="settings-theme-options" role="radiogroup">
                  <button aria-checked={theme === "light"} onClick={() => onThemeChange("light")} role="radio" type="button">
                    <span className="settings-theme-preview settings-theme-preview--light" />
                    <span><Icon name="sun" size={13} />{t("settings.theme.light")}</span>
                  </button>
                  <button aria-checked={theme === "dark"} onClick={() => onThemeChange("dark")} role="radio" type="button">
                    <span className="settings-theme-preview settings-theme-preview--dark" />
                    <span><Icon name="moon" size={13} />{t("settings.theme.dark")}</span>
                  </button>
                </div>
              </section>
              <section className="settings-group">
                <header><strong>{t("settings.accent.title")}</strong><span>{t("settings.accent.description")}</span></header>
                <div className="settings-accent-control">
                  <ColorPicker icon="edit" label={t("settings.accent.title")} onChange={onAccentColorChange} selected value={accentColor} />
                  <span>{accentColor.toUpperCase()}</span>
                </div>
              </section>
              <section className="settings-group">
                <header><strong>{t("settings.locale.title")}</strong><span>{t("settings.locale.description")}</span></header>
                <div className="settings-locale-control">
                  <Select
                    label={t("settings.locale.label")}
                    onChange={(value) => onLocaleChange(value as Locale)}
                    options={localeOptions.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                    value={locale}
                  />
                </div>
              </section>
            </>
          )}

          {activeSection === "timer" && <TimerSettingsPanel store={timerSettingsStore} />}

          {activeSection === "server" && <ServerSettingsPanel store={serverSettingsStore} />}

          {activeSection === "ai" && <AiSettingsPanel store={aiSettingsStore} />}

          {activeSection === "storage" && (
            <>
              <StorageSettingsPanel mediaMaintenance={mediaMaintenance} />
              <R2CredentialsSection store={r2SettingsStore} />
              <R2UsageSection store={r2SettingsStore} />
            </>
          )}

          {activeSection === "about" && (
            <>
              <SettingsHeading description={t("settings.about.description")} title={t("settings.section.about")} />
              <section aria-label={t("settings.about.update")} className="settings-group">
                <div className="settings-version"><span>{t("settings.about.version")}</span><strong>{__APP_VERSION__}</strong></div>
                <Button onClick={() => window.dispatchEvent(new Event(CHECK_UPDATE_EVENT))} type="button">{t("settings.about.checkUpdate")}</Button>
              </section>
            </>
          )}
        </section>
      </div>
    </Modal>
  );
}
