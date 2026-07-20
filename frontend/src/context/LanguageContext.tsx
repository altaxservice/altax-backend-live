import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { translate, type Lang } from "../i18n/translations";
import { useAuth } from "../auth/AuthContext";

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
  const { user } = useAuth();
  // The Arabic toggle is a client/employee-only feature — admin/staff should
  // never see it, regardless of what's sitting in localStorage. Previously the
  // stored preference (e.g. set once while testing as a client account on this
  // same browser) applied to EVERY role on next load, since this provider read
  // localStorage directly with no role check — an admin could open the app and
  // silently get the whole sidebar/header in Arabic with no toggle visible to
  // switch it back. lang/localStorage still track the real stored preference
  // (so a client's choice persists correctly); effectiveLang is what actually
  // renders, and is hard-pinned to English for every other role.
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem(STORAGE_KEY) as Lang) || "en");
  const canUseArabic = user?.role === "client" || user?.role === "employee";
  const effectiveLang: Lang = canUseArabic ? lang : "en";

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, lang);
  }, [lang]);

  const value: LanguageContextValue = {
    lang: effectiveLang,
    setLang: setLangState,
    t: (key: string) => translate(effectiveLang, key),
    dir: effectiveLang === "ar" ? "rtl" : "ltr",
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
