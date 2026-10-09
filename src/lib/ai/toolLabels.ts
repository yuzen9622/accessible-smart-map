import type { TFunction } from "i18next";

/** Translate at render time so existing tool history follows the UI language. */
export function toolLoadingLabel(name: string, t: TFunction): string {
  return t(`chatbot.trace.tools.${name}.loading`, {
    defaultValue: t("chatbot.trace.unknownLoading", { name }),
  });
}

/** Unknown tools retain their original name. */
export function toolDoneLabel(name: string, t: TFunction): string {
  return t(`chatbot.trace.tools.${name}.label`, { defaultValue: name });
}
