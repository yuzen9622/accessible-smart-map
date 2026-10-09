import i18n from "i18next";
import { redirect, usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";
import {
  initReactI18next,
  useTranslation as useReactTranslation,
} from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import en from "@/i18n/locale/en/translation.json";
import zhTW from "@/i18n/locale/zh-TW/translation.json";
import type { LanguageEnum } from "@/lib/config";
import useAuthStore from "@/stores/useAuthStore";
import { fallbackLng, languages } from "./setting";

const resources = {
  en: { translation: en },
  "zh-TW": { translation: zhTW },
};

// init 只要執行一次
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources,
    lng: fallbackLng,
    fallbackLng: fallbackLng,
    supportedLngs: languages,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

export function changeAppLanguage(lng: "en" | "zh-TW") {
  void i18n.changeLanguage(lng);
}

// client-safe useTranslation wrapper
// 用法： const { t, i18n } = useAppTranslation(); 或 useAppTranslation("en", "translation");
export function useAppTranslation(ns?: string | string[]) {
  const ret = useReactTranslation(ns as string, { useSuspense: false });
  const path = usePathname();

  const lang = useMemo(() => path.split("/")[1], [path]);
  const { updateUserConfig, userConfig } = useAuthStore(
    useShallow((s) => ({
      updateUserConfig: s.updateUserConfig,
      userConfig: s.userConfig,
    })),
  );

  useEffect(() => {
    if (!userConfig.language) return;
    // 只有在語言不同時才切換，避免重複呼叫
    if (ret.i18n.language !== userConfig.language) {
      void ret.i18n.changeLanguage(userConfig.language);
      updateUserConfig({ language: userConfig.language as LanguageEnum });
    }
    document.documentElement.lang = userConfig.language;
  }, [userConfig.language, ret.i18n, updateUserConfig]);
  useEffect(() => {
    // 只有在語言不同時才切換，避免重複呼叫
    if (
      userConfig.language !== lang &&
      languages.includes(lang) &&
      languages.includes(userConfig.language)
    ) {
      // A router navigation remounts the language layout and ends voice/navigation.
      // Keep the live page while updating the locale URL through Next's History API.
      const segments = path.split("/");
      segments[1] = userConfig.language;
      window.history.replaceState(
        null,
        "",
        `${segments.join("/")}${window.location.search}${window.location.hash}`,
      );
    } else if (!languages.includes(lang)) {
      redirect(`/${fallbackLng}`);
    }
  }, [lang, path, userConfig.language]);
  return ret;
}

export default i18n;
