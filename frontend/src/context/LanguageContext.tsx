import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { translate, type Lang } from "../i18n/translations";

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string) => string;
  dir: "ltr" | "rtl";
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: "en", setLang: () => {}, t: (key) => key, dir: "ltr",
});

const STORAGE_KEY = "altax_lang";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem(STORAGE_KEY) as Lang) || "en");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
  }, [lang]);

  const value: LanguageContextValue = {
    lang,
    setLang: setLangState,
    t: (key: string) => translate(lang, key),
    dir: lang === "ar" ? "rtl" : "ltr",
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

/**
 * Wraps a number/currency/date/ID value so it never gets visually reordered when
 * it sits inside an Arabic (RTL) sentence — per the explicit instruction to keep
 * all numbers and symbols in plain English regardless of language. Safe/inert in
 * English mode too.
 */
export function Num({ children }: { children: ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}
