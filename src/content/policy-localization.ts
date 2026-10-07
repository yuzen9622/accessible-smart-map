import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  operatorDetails,
  policyEffectiveDate,
  privacyPolicy,
  termsOfUse,
} from "./policies";
import { privacyPolicyEn, termsOfUseEn } from "./policies.en";

export const policyLocales = ["zh-TW", "en"] as const;
export type PolicyLocale = (typeof policyLocales)[number];
export type PolicyKind = "privacy-policy" | "terms-of-use";

export function getPolicyLocale(value: string): PolicyLocale {
  if (value === "zh-TW" || value === "en") return value;
  notFound();
}

export function policyHref(locale: PolicyLocale, kind: PolicyKind) {
  return `/${locale}/policies/${kind}/`;
}

export function getPolicy(locale: PolicyLocale, kind: PolicyKind) {
  if (kind === "privacy-policy") {
    return locale === "en" ? privacyPolicyEn : privacyPolicy;
  }
  return locale === "en" ? termsOfUseEn : termsOfUse;
}

export const policyUi = {
  "zh-TW": {
    brand: "無障礙智慧地圖",
    documents: "政策文件",
    skip: "跳至文件內容",
    privacy: "隱私權政策",
    terms: "服務條款",
    backToTop: "回到文件開頭 ↑",
    languages: "選擇語言",
    updated: "最後更新：",
    contents: "本頁內容",
    table: "資料表，可水平捲動",
    related: "相關文件",
    readPrivacy: "閱讀隱私權政策 →",
    readTerms: "閱讀服務條款 →",
  },
  en: {
    brand: "Accessible Smart Map",
    documents: "Policies",
    skip: "Skip to document",
    privacy: "Privacy Policy",
    terms: "Terms of Use",
    backToTop: "Back to top ↑",
    languages: "Choose language",
    updated: "Last updated:",
    contents: "On this page",
    table: "data table, scroll horizontally",
    related: "Related document",
    readPrivacy: "Read the Privacy Policy →",
    readTerms: "Read the Terms of Use →",
  },
} as const;

export function getOperatorDetails(locale: PolicyLocale) {
  if (locale === "zh-TW") return operatorDetails;
  return [
    {
      label: "Operator",
      value:
        "國立臺中科技大學教育大數據實驗室 (Education Big Data Laboratory, National Taichung University of Science and Technology)",
    },
    {
      label: "Privacy and support email",
      value: "nutcaiedlab@gmail.com",
      href: "mailto:nutcaiedlab@gmail.com",
    },
    {
      label: "Contact address",
      value:
        "No. 129, Sec. 3, Sanmin Rd., North Dist., Taichung City 404336, Taiwan (Sanmin Campus, National Taichung University of Science and Technology)",
    },
    { label: "Effective date", value: policyEffectiveDate },
  ];
}

export function getPolicyMetadata(
  locale: PolicyLocale,
  kind: PolicyKind,
): Metadata {
  const policy = getPolicy(locale, kind);
  return {
    title: `${policy.title} | ${policyUi[locale].brand}`,
    description: policy.introduction,
    alternates: {
      canonical: policyHref(locale, kind),
      languages: {
        "zh-TW": policyHref("zh-TW", kind),
        en: policyHref("en", kind),
        "x-default": policyHref("zh-TW", kind),
      },
    },
  };
}
