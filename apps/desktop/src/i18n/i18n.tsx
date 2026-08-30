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

function translate(locale: Locale, key: TranslationKey, values?: InterpolationValues) {
  const template = messages[locale][key] ?? messages.ko[key];
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = values[name];
    return value === undefined ? placeholder : String(value);
  });
}

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
    t: (key, values) => translate(locale, key, values),
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
  const value = useMemo(() => createValue(locale, setLocale), [locale]);

  useEffect(() => {
    document.documentElement.lang = languageTags[locale];
    document.documentElement.dir = "ltr";
    try {
      storage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // 저장소가 차단되어도 현재 세션의 언어 설정은 유지한다.
    }
  }, [locale, storage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
