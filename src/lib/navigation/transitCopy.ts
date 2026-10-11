// 公車段導引的文字（HUD、Live Activity、播報共用同一套組法）。只依賴傳入的翻譯函式，不碰 i18n 實例。

import {
  BUS_ARRIVING_MINUTES,
  type TransitGuide,
  type TransitSpeech,
} from "./transitRide";

export type Translate = (
  key: string,
  options?: Record<string, string | number>,
) => string;

type WaitingGuide = Extract<TransitGuide, { phase: "approaching" | "waiting" }>;
type RidingGuide = Extract<TransitGuide, { phase: "riding" }>;

/** 等車的分鐘數句子（「小18 約 4 分鐘到站」／「即將進站」／「暫無即時到站資訊」）。 */
export function waitLine(t: Translate, guide: WaitingGuide): string {
  const wait = guide.waitMinutes;
  if (wait === null) return t("navBusWaitLineUnknown");
  if (wait <= BUS_ARRIVING_MINUTES)
    return t("navBusWaitLineArriving", { route: guide.routeName });
  return t("navBusWaitLine", { route: guide.routeName, count: wait });
}

/** HUD 大字：等車時是分鐘數、搭乘時是剩幾站（沒有站數就顯示分鐘）。null＝沿用距離。 */
export function transitHeadline(
  t: Translate,
  guide: TransitGuide,
): string | null {
  if (guide.phase !== "riding") {
    if (guide.phase === "approaching") return null;
    const wait = guide.waitMinutes;
    if (wait === null) return t("navBusWaitUnknown");
    if (wait === 0) return t("navBusArrivingNow");
    if (wait <= BUS_ARRIVING_MINUTES) return t("navBusArrivingSoon");
    return t("navBusWaitMinutes", { count: wait });
  }
  if (guide.stopsLeft !== null && guide.stopsLeft >= 1)
    return t("navBusStopsLeft", { count: guide.stopsLeft });
  return guide.minutes !== null
    ? t("navBusWaitMinutes", { count: guide.minutes })
    : null;
}

function rideInstruction(t: Translate, guide: RidingGuide): string {
  if (guide.stopsLeft === 1)
    return t("navBusNextStopAlight", { stop: guide.alightStop });
  return guide.minutes !== null
    ? t(
        guide.minutesSource === "estimated"
          ? "navBusRideEstimated"
          : "navBusRideInstruction",
        { count: guide.minutes, stop: guide.alightStop },
      )
    : t("navBusRideInstructionNoTime", { stop: guide.alightStop });
}

/** HUD 主指示（大字下方）。 */
export function transitInstruction(t: Translate, guide: TransitGuide): string {
  if (guide.phase === "riding") return rideInstruction(t, guide);
  const key =
    guide.phase === "waiting"
      ? "navBusWaitInstruction"
      : "navBusApproachInstruction";
  return t(key, { stop: guide.boardStop, route: guide.routeName });
}

/** HUD 指示下方的補充列：等車時的即時分鐘數；搭乘時沒有（大字已是站數、主指示已是分鐘）。 */
export function transitDetail(
  t: Translate,
  guide: TransitGuide,
): string | null {
  return guide.phase === "riding" ? null : waitLine(t, guide);
}

/** 鎖定畫面／動態島：一行裝得下的完整情境。 */
export function transitLiveText(t: Translate, guide: TransitGuide): string {
  if (guide.phase === "riding") {
    const headline = transitHeadline(t, guide);
    const instruction = rideInstruction(t, guide);
    return headline && guide.stopsLeft !== 1
      ? `${headline} · ${instruction}`
      : instruction;
  }
  return `${transitInstruction(t, guide)} · ${waitLine(t, guide)}`;
}

function waitSpeech(
  t: Translate,
  routeName: string,
  wait: number | null,
): string {
  if (wait === null) return t("navBusSpeakNoLive");
  if (wait <= BUS_ARRIVING_MINUTES)
    return t("navBusSpeakArriving", { route: routeName });
  return t("navBusSpeakWait", { route: routeName, count: wait });
}

/** 播報文字。句子之間以空白相接：英文需要，中文 TTS 不受影響（只用於播報，不顯示）。 */
export function transitSpeechText(
  t: Translate,
  speech: TransitSpeech | { kind: "alight"; alightStop: string },
): string {
  switch (speech.kind) {
    case "approach":
      return (
        t("navBusSpeakApproach", {
          stop: speech.boardStop,
          route: speech.routeName,
        }) +
        " " +
        waitSpeech(t, speech.routeName, speech.waitMinutes)
      );
    case "atStop":
      return (
        t("navBusSpeakAtStop", { stop: speech.boardStop }) +
        " " +
        waitSpeech(t, speech.routeName, speech.waitMinutes)
      );
    case "busSoon":
      return waitSpeech(t, speech.routeName, speech.waitMinutes);
    case "busArriving":
      return t("navBusSpeakArriving", { route: speech.routeName });
    case "boarded": {
      const parts = [t("navBusSpeakBoarded")];
      if (speech.stopsLeft === 1)
        parts.push(t("navBusSpeakNextAlight", { stop: speech.alightStop }));
      else {
        parts.push(
          speech.stopsLeft !== null
            ? t("navBusSpeakStopsLeft", {
                count: speech.stopsLeft,
                stop: speech.alightStop,
              })
            : t("navBusSpeakRideTo", { stop: speech.alightStop }),
        );
        if (speech.minutes !== null)
          parts.push(t("navBusSpeakMinutesTo", { count: speech.minutes }));
      }
      return parts.join(" ");
    }
    case "stopsLeft":
      return (
        t("navBusSpeakStopsLeft", {
          count: speech.stopsLeft,
          stop: speech.alightStop,
        }) +
        (speech.minutes !== null
          ? ` ${t("navBusSpeakMinutesTo", { count: speech.minutes })}`
          : "")
      );
    case "nextStopAlight":
      return t("navBusSpeakNextAlight", { stop: speech.alightStop });
    case "alight":
      return t("navBusSpeakAlight", { stop: speech.alightStop });
  }
}

/** Defaults keep independently integrated navigation UI readable before dictionary merge. */
export const navigationCopyDefaults = {
  "zh-TW": {
    navBusWaitMinutes: "{{count}} 分鐘",
    navBusArrivingNow: "進站中",
    navBusArrivingSoon: "即將進站",
    navBusWaitUnknown: "等候公車",
    navBusApproachInstruction: "前往「{{stop}}」站牌搭乘「{{route}}」",
    navBusWaitInstruction: "請在「{{stop}}」站牌等候「{{route}}」",
    navBusWaitLine: "「{{route}}」約 {{count}} 分鐘到站",
    navBusWaitLineArriving: "「{{route}}」即將進站，請準備上車",
    navBusWaitLineUnknown: "暫無即時到站資訊",
    navBusStopsLeft: "還有 {{count}} 站",
    navBusRideInstruction: "約 {{count}} 分鐘到「{{stop}}」，到站後請下車",
    navBusRideInstructionNoTime: "到「{{stop}}」後請下車",
    navBusNextStopAlight: "下一站「{{stop}}」，請準備下車",
    navBusSpeakApproach: "請前往「{{stop}}」站牌搭乘「{{route}}」。",
    navBusSpeakAtStop: "已到達「{{stop}}」站牌。",
    navBusSpeakWait: "「{{route}}」約 {{count}} 分鐘到站。",
    navBusSpeakArriving: "「{{route}}」即將進站，請準備上車。",
    navBusSpeakNoLive: "目前沒有即時到站資訊。",
    navBusSpeakBoarded: "已上車。",
    navBusSpeakStopsLeft: "還有 {{count}} 站到「{{stop}}」。",
    navBusSpeakMinutesTo: "約 {{count}} 分鐘到。",
    navBusSpeakRideTo: "到「{{stop}}」下車。",
    navBusSpeakNextAlight: "下一站「{{stop}}」，請準備下車。",
    navBusSpeakAlight: "已到「{{stop}}」，請下車。",
    navPreview: "路線預覽",
    navPreviewDesc:
      "定位接近路線後會自動開始即時導航。預覽不會播報或判定抵達。",
    navLive: "即時導航",
    navPrevious: "上一步",
    navNext: "下一步",
    navBusBoardedConfirm: "我已上車",
    navBusRideEstimated: "預估約 {{count}} 分鐘後在「{{stop}}」下車",
  },
  en: {
    navBusWaitMinutes_one: "{{count}} min",
    navBusWaitMinutes_other: "{{count}} min",
    navBusArrivingNow: "Arriving",
    navBusArrivingSoon: "Arriving soon",
    navBusWaitUnknown: "Waiting for bus",
    navBusApproachInstruction: "Go to the {{stop}} stop for {{route}}",
    navBusWaitInstruction: "Wait at {{stop}} for {{route}}",
    navBusWaitLine_one: "{{route}} arrives in about {{count}} min",
    navBusWaitLine_other: "{{route}} arrives in about {{count}} min",
    navBusWaitLineArriving: "{{route}} is arriving. Get ready to board",
    navBusWaitLineUnknown: "No live arrival info",
    navBusStopsLeft_one: "{{count}} stop left",
    navBusStopsLeft_other: "{{count}} stops left",
    navBusRideInstruction_one: "About {{count}} min to {{stop}}. Get off there",
    navBusRideInstruction_other:
      "About {{count}} min to {{stop}}. Get off there",
    navBusRideInstructionNoTime: "Get off at {{stop}}",
    navBusNextStopAlight: "Next stop {{stop}}. Get ready to get off",
    navBusSpeakApproach: "Head to the {{stop}} stop for {{route}}.",
    navBusSpeakAtStop: "You're at the {{stop}} stop.",
    navBusSpeakWait_one: "{{route}} arrives in about {{count}} minute.",
    navBusSpeakWait_other: "{{route}} arrives in about {{count}} minutes.",
    navBusSpeakArriving: "{{route}} is arriving. Get ready to board.",
    navBusSpeakNoLive: "No live arrival information right now.",
    navBusSpeakBoarded: "You're on board.",
    navBusSpeakStopsLeft_one: "{{count}} stop to {{stop}}.",
    navBusSpeakStopsLeft_other: "{{count}} stops to {{stop}}.",
    navBusSpeakMinutesTo_one: "About {{count}} minute to go.",
    navBusSpeakMinutesTo_other: "About {{count}} minutes to go.",
    navBusSpeakRideTo: "Get off at {{stop}}.",
    navBusSpeakNextAlight: "Next stop, {{stop}}. Get ready to get off.",
    navBusSpeakAlight: "This is {{stop}}. Please get off.",
    navPreview: "Route preview",
    navPreviewDesc:
      "Live navigation starts when GPS is near the route. Preview does not announce or detect arrival.",
    navLive: "Live navigation",
    navPrevious: "Previous step",
    navNext: "Next step",
    navBusBoardedConfirm: "I have boarded",
    navBusRideEstimated: "Estimated {{count}} min to alight at {{stop}}",
    navBusWaitMinutes: "{{count}} min",
    navBusWaitLine: "{{route}} arrives in about {{count}} min",
    navBusStopsLeft: "{{count}} stops left",
    navBusRideInstruction: "About {{count}} min to {{stop}}. Get off there",
    navBusSpeakWait: "{{route}} arrives in about {{count}} minutes.",
    navBusSpeakStopsLeft: "{{count}} stops to {{stop}}.",
    navBusSpeakMinutesTo: "About {{count}} minutes to go.",
  },
} as const;

export function navigationCopyDefault(
  language: string,
  key: string,
  count?: string | number,
): string {
  const defaults: Record<string, string> =
    navigationCopyDefaults[language === "en" ? "en" : "zh-TW"];
  return (
    defaults[`${key}_${count === 1 ? "one" : "other"}`] ?? defaults[key] ?? key
  );
}
