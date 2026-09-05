import { configureUiMessages, type UiMessages } from "@mono/ui";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { koMessages, type TranslationKey } from "./messages.ko";

export const LOCALE_STORAGE_KEY = "mono.locale";
export const supportedLocales = ["ko"] as const;
export type Locale = (typeof supportedLocales)[number];

const messages: Record<Locale, Record<TranslationKey, string>> = {
  ko: koMessages,
};

const languageTags: Record<Locale, string> = {
  ko: "ko-KR",
};

let activeLocale: Locale = "ko";

export const localeOptions: ReadonlyArray<{ value: Locale; labelKey: TranslationKey }> = [
  { value: "ko", labelKey: "settings.locale.korean" },
];

type InterpolationValues = Record<string, string | number>;

export function isSupportedLocale(value: string | null): value is Locale {
  return supportedLocales.includes(value as Locale);
}

export function readLocale(storage: Pick<Storage, "getItem">): Locale {
  try {
    const stored = storage.getItem(LOCALE_STORAGE_KEY);
    return isSupportedLocale(stored) ? stored : "ko";
  } catch {
    return "ko";
  }
}

function translateForLocale(locale: Locale, key: TranslationKey, values?: InterpolationValues) {
  const template = messages[locale][key] ?? messages.ko[key];
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : String(value);
  });
}

/** Uses the same translation catalog even outside React, from stores and constants. */
export function translate(key: TranslationKey, values?: InterpolationValues) {
  return translateForLocale(activeLocale, key, values);
}

function uiMessagesForLocale(locale: Locale): UiMessages {
  const message = (key: TranslationKey, values?: InterpolationValues) => translateForLocale(locale, key, values);
  return {
    weekdays: [message("ui.weekday.sun"), message("ui.weekday.mon"), message("ui.weekday.tue"), message("ui.weekday.wed"), message("ui.weekday.thu"), message("ui.weekday.fri"), message("ui.weekday.sat")],
    dateMonth: message("ui.date.month"),
    dateDay: message("ui.date.day"),
    dateTodaySuffix: message("ui.date.todaySuffix"),
    dateSelectedSuffix: message("ui.date.selectedSuffix"),
    dateSelect: message("ui.date.select"),
    pickerSelect: message("ui.picker.select"),
    previousMonth: message("ui.date.previousMonth"),
    nextMonth: message("ui.date.nextMonth"),
    clear: message("ui.action.clear"),
    today: message("ui.action.today"),
    select: message("ui.action.select"),
    options: message("ui.select.options"),
    colorSelect: message("ui.color.select"),
    colorSelectClose: message("ui.color.close"),
    hue: message("ui.color.hue"),
    hexColor: message("ui.color.hex"),
    timeSelect: message("ui.time.select"),
    timeDialogOpen: message("ui.time.openDial"),
    am: message("ui.time.am"),
    pm: message("ui.time.pm"),
    hour: message("ui.time.hour"),
    minute: message("ui.time.minute"),
    done: message("ui.action.done"),
    confidence: message("ui.confidence"),
    close: message("ui.action.close"),
  };
}

configureUiMessages(uiMessagesForLocale(activeLocale));

function parseIsoLocal(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export type DateLabelStyle = "long" | "short" | "none";

type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, values?: InterpolationValues) => string;
  formatDate: (iso: string, style?: DateLabelStyle) => string;
  formatMonth: (iso: string) => string;
};

const defaultValue: I18nValue = createValue("ko", () => {});
const I18nContext = createContext<I18nValue>(defaultValue);

function createValue(locale: Locale, setLocale: (locale: Locale) => void): I18nValue {
  const languageTag = languageTags[locale];
  return {
    locale,
    setLocale,
    t: (key, values) => translateForLocale(locale, key, values),
    formatDate: (iso, style = "long") => {
      const date = parseIsoLocal(iso);
      const base = new Intl.DateTimeFormat(languageTag, { year: "numeric", month: "long", day: "numeric" }).format(date);
      if (style === "none") return base;
      const weekday = new Intl.DateTimeFormat(languageTag, { weekday: style === "short" ? "short" : "long" }).format(date);
      return style === "short" ? `${base} (${weekday})` : `${base} ${weekday}`;
    },
    formatMonth: (iso) => new Intl.DateTimeFormat(languageTag, { year: "numeric", month: "long" }).format(parseIsoLocal(iso)),
  };
}

export function I18nProvider({ children, storage = window.localStorage }: { children: ReactNode; storage?: Storage }) {
  const [locale, setLocale] = useState<Locale>(() => readLocale(storage));
  activeLocale = locale;
  configureUiMessages(uiMessagesForLocale(locale));
  const value = useMemo(() => createValue(locale, setLocale), [locale]);

  useEffect(() => {
    document.documentElement.lang = languageTags[locale];
    document.documentElement.dir = "ltr";
    try {
      storage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // Even if storage is blocked, the current session's language setting is kept.
    }
  }, [locale, storage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
