import i18n, { type ReactOptions } from "i18next";
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
const reactOptions: ReactOptions = {
  useSuspense: false,
  bindI18nStore: "added removed",
};

function containsTranslations(current: unknown, bundled: unknown): boolean {
  if (current === bundled) return true;
  if (
    !current ||
    typeof current !== "object" ||
    !bundled ||
    typeof bundled !== "object"
  )
    return false;
  return Object.entries(bundled).every(([key, value]) =>
    containsTranslations((current as Record<string, unknown>)[key], value),
  );
}

// init 只要執行一次
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources,
    lng: fallbackLng,
    fallbackLng: fallbackLng,
    supportedLngs: languages,
    interpolation: { escapeValue: false },
    react: reactOptions,
  });
} else {
  // Fast Refresh preserves the i18next instance while reloading JSON modules.
  // Update its dictionaries without resetting the user's language or session.
  for (const [language, { translation }] of Object.entries(resources)) {
    const current = i18n.getResourceBundle(language, "translation");
    if (!containsTranslations(current, translation)) {
      i18n.addResourceBundle(language, "translation", translation, true, true);
    }
  }
}

export function changeAppLanguage(lng: "en" | "zh-TW") {
  void i18n.changeLanguage(lng);
}

// client-safe useTranslation wrapper
// 用法： const { t, i18n } = useAppTranslation(); 或 useAppTranslation("en", "translation");
export function useAppTranslation(ns?: string | string[]) {
  const ret = useReactTranslation(ns as string, reactOptions);
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
