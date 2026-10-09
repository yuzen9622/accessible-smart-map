import i18n from "i18next";
import { toApiLang } from "@/lib/place/lang";
import { fallbackLng } from "./setting";

/** Read the effective UI language at request time, using the existing mapping. */
export function getAppLanguage(): "zh-TW" | "en" {
  return toApiLang(i18n.resolvedLanguage ?? i18n.language) ?? fallbackLng;
}
