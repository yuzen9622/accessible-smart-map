// 公車段的等車／搭乘導引（純函式）。後端的 `transit_board`／`transit_alight` 指令沒有 polylineIndex，
// 轉向點分別落在公車段起點（上車站）與終點（下車站）：只靠定位推進的話，人一走到站牌就被當成已上車，
// HUD 直接跳到「到站後請下車」。這裡把公車段拆成「前往站牌 → 等車 → 搭乘」三個階段，
// 上車由定位判斷（離開站牌、沿公車路線前進），等車／搭乘的分鐘數由公車 feature 的即時資料提供。

import { type CumulativePath, projectToPath } from "@/lib/geo";
import type { BusLeg, NavInstruction } from "@/types/route";

/** 一段連續的 BUS 步驟：上車指令到下車指令。`ordinal` 是第幾段公車（0 起算，與 route.legs 中 BUS leg 的順序一致）。 */
export interface BusRun {
  ordinal: number;
  boardIndex: number;
  alightIndex: number;
  legIndex: number;
}

/** 依序列出所有連續 BUS 步驟區間（同一路線可能搭同一條線兩次，所以以區間而非 leg 類型識別）。 */
export function busStepRuns(
  instructions: readonly NavInstruction[],
): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let start: number | null = null;
  for (let i = 0; i < instructions.length; i++) {
    const isBus = instructions[i]?.legType === "BUS";
    // Direct transfers need a boundary even when no walking instruction separates them.
    if (
      isBus &&
      start !== null &&
      instructions[i]?.legIndex != null &&
      instructions[i].legIndex !== instructions[start]?.legIndex
    ) {
      runs.push({ start, end: i - 1 });
      start = i;
    }
    if (isBus && start === null) start = i;
    if (!isBus && start !== null) {
      runs.push({ start, end: i - 1 });
      start = null;
    }
  }
  if (start !== null) runs.push({ start, end: instructions.length - 1 });
  return runs;
}

/** 一段 BUS 步驟是不是完整的「上車…下車」（有 transit_board／transit_alight 與同一個 legIndex）。 */
function toBusRun(
  instructions: readonly NavInstruction[],
  run: { start: number; end: number },
  ordinal: number,
): BusRun | null {
  const board = instructions[run.start];
  const alight = instructions[run.end];
  if (
    run.end <= run.start ||
    board?.type !== "transit_board" ||
    alight?.type !== "transit_alight"
  )
    return null;
  if (board.legIndex == null || board.legIndex !== alight.legIndex) return null;
  return {
    ordinal,
    boardIndex: run.start,
    alightIndex: run.end,
    legIndex: board.legIndex,
  };
}

/** 所有形狀完整的公車段（`ordinal` 仍按全部 BUS 步驟區間計，與 `resolveActiveBusLegOrdinal` 一致）。 */
export function findBusRuns(instructions: readonly NavInstruction[]): BusRun[] {
  return busStepRuns(instructions)
    .map((run, ordinal) => toBusRun(instructions, run, ordinal))
    .filter((run): run is BusRun => run !== null);
}

/**
 * 使用者正在搭、或接下來要搭的那段公車。指令不是「上車…下車」的完整形狀（缺 transit_board／transit_alight、
 * 沒有 legIndex）時回 null：呼叫端維持原本只靠定位推進的行為，不猜。
 */
export function findActiveBusRun(
  instructions: readonly NavInstruction[],
  currentStepIndex: number,
): BusRun | null {
  const runs = busStepRuns(instructions);
  let ordinal = runs.findIndex(
    (r) => currentStepIndex >= r.start && currentStepIndex <= r.end,
  );
  if (ordinal === -1)
    ordinal = runs.findIndex((r) => r.start > currentStepIndex);
  if (ordinal === -1) return null;
  return toBusRun(instructions, runs[ordinal], ordinal);
}

/** 離上車站（沿路線）這麼近就算到站牌了：開始等車。 */
export const AT_STOP_RADIUS_M = 30;
export interface RideStop {
  name: string;
  /** 沿整條串接路徑的距離（公尺）。 */
  alongM: number;
}

/** 這麼接近一站就算已到該站（站牌有寬度，車也不會剛好停在站位點上）。 */
export const STOP_REACHED_M = 30;

/**
 * 公車段沿線的停靠站（不含上車站、含下車站），以沿路線距離排序。中途站缺座標時回 null：
 * 數不出正確站數，就不顯示「還有幾站」，不拿少算的站數誤導人提早下車。
 */
export function rideStops(
  leg: BusLeg,
  cp: CumulativePath,
  legIndex: number,
): RideStop[] | null {
  const range = cp.legRanges[legIndex];
  if (!range || range.count < 2 || !leg.intermediateStops) return null;
  const path = cp.path.slice(range.start, range.start + range.count);
  const cumM = cp.cumM.slice(range.start, range.start + range.count);
  const stops: RideStop[] = [];
  for (const stop of leg.intermediateStops ?? []) {
    if (!stop.location?.every(Number.isFinite)) return null;
    const [lng, lat] = stop.location;
    const projection = projectToPath({ lat, lng }, path, cumM);
    if (projection.perpDistM > 50) return null;
    stops.push({ name: stop.name, alongM: projection.alongM });
  }
  stops.push({ name: leg.arrivalStop, alongM: cumM[cumM.length - 1] ?? 0 });
  // 投影可能因折返路線落到後段：站序必須沿線遞增，否則站數不可信。
  for (let i = 1; i < stops.length; i++) {
    if (stops[i].alongM <= stops[i - 1].alongM) return null;
  }
  return stops;
}

/** 還沒到的站數（含下車站）與下一站。 */
export function stopsAhead(
  stops: readonly RideStop[],
  alongM: number,
): { count: number; next: RideStop | null } {
  const ahead = stops.filter((s) => s.alongM - STOP_REACHED_M > alongM);
  return { count: ahead.length, next: ahead[0] ?? null };
}

/** 規劃的乘車分鐘數：`rideMinutes`，沒有就由上下車時刻（HH:mm，可跨午夜）推算。 */
export function plannedRideMinutes(leg: BusLeg): number | null {
  const selected = leg.selectedDeparture;
  if (selected?.boardingTime && selected.alightingTime) {
    const duration =
      (Date.parse(selected.alightingTime) - Date.parse(selected.boardingTime)) /
      60_000;
    if (Number.isFinite(duration) && duration > 0) return duration;
  }
  const parse = (time?: string) => {
    const match = time ? /^(\d{1,2}):(\d{2})$/.exec(time) : null;
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const from = parse(leg.departureTime);
  const to = parse(leg.arrivalTime);
  if (from === null || to === null) return null;
  const minutes = (to - from + 24 * 60) % (24 * 60);
  return minutes > 0 ? minutes : null;
}

/** 沒有即時資料時，按剩餘距離比例估到下車站的分鐘數（至少 1 分鐘）。 */
export function estimateRideMinutes(
  remainingM: number,
  legTotalM: number,
  planned: number | null,
): number | null {
  if (planned === null || legTotalM <= 0) return null;
  return Math.max(
    1,
    Math.ceil((planned * Math.max(0, remainingM)) / legTotalM),
  );
}

export type TransitGuide =
  | {
      /** 還在走往上車站（目前步驟已是上車指令，但還沒到站牌）。 */
      phase: "approaching" | "waiting";
      routeName: string;
      boardStop: string;
      /** 上車站下一班的即時分鐘數；查不到為 null。 */
      waitMinutes: number | null;
    }
  | {
      phase: "riding";
      routeName: string;
      alightStop: string;
      /** 還有幾站（含下車站）；中途站缺座標時為 null。 */
      stopsLeft: number | null;
      /** 到下車站的分鐘數；`realtime`＝那台車的即時到站，`estimated`＝按剩餘距離估。 */
      minutes: number | null;
      minutesSource: "realtime" | "estimated" | null;
    };

export interface TransitGuideInput {
  run: BusRun;
  leg: BusLeg;
  boarded: boolean;
  /** 沿整條路徑的位置；還沒有定位樣本時為 null。 */
  alongM: number | null;
  boardAlongM: number;
  stops: readonly RideStop[] | null;
  legEndAlongM: number;
  /** 公車 feature 的即時分鐘數：等車時是上車站、上車後是下車站。 */
  liveMinutes: number | null;
}

/** 目前步驟落在公車段（含上車指令）時的導引；不在公車段回 null。 */
export function buildTransitGuide(
  input: TransitGuideInput,
  currentStepIndex: number,
): TransitGuide | null {
  const { run, leg } = input;
  const routeName = leg.subRouteName ?? leg.routeName;
  if (currentStepIndex < run.boardIndex || currentStepIndex > run.alightIndex)
    return null;
  if (!input.boarded) {
    const atStop =
      input.alongM !== null &&
      input.alongM >= input.boardAlongM - AT_STOP_RADIUS_M;
    return {
      phase: atStop ? "waiting" : "approaching",
      routeName,
      boardStop: leg.departureStop,
      waitMinutes: input.liveMinutes,
    };
  }
  const along = input.alongM ?? input.boardAlongM;
  const stopsLeft = input.stops ? stopsAhead(input.stops, along).count : null;
  const legTotalM = input.legEndAlongM - input.boardAlongM;
  const estimated = estimateRideMinutes(
    input.legEndAlongM - along,
    legTotalM,
    plannedRideMinutes(leg),
  );
  const minutes = input.liveMinutes ?? estimated;
  return {
    phase: "riding",
    routeName,
    alightStop: leg.arrivalStop,
    stopsLeft,
    minutes,
    minutesSource:
      input.liveMinutes !== null
        ? "realtime"
        : estimated !== null
          ? "estimated"
          : null,
  };
}

export type TransitSpeech =
  | {
      kind: "approach";
      routeName: string;
      boardStop: string;
      waitMinutes: number | null;
    }
  | {
      kind: "atStop";
      routeName: string;
      boardStop: string;
      waitMinutes: number | null;
    }
  | { kind: "busSoon"; routeName: string; waitMinutes: number }
  | { kind: "busArriving"; routeName: string }
  | {
      kind: "boarded";
      alightStop: string;
      stopsLeft: number | null;
      minutes: number | null;
    }
  | {
      kind: "stopsLeft";
      alightStop: string;
      stopsLeft: number;
      minutes: number | null;
    }
  | { kind: "nextStopAlight"; alightStop: string }
  | { kind: "alight"; alightStop: string };

/** 等車時快到的門檻（分鐘）：到這裡提醒一次，進站再提醒一次。 */
export const BUS_SOON_MINUTES = 3;
export const BUS_ARRIVING_MINUTES = 1;
/** 等車分鐘數一次跳大這麼多：原本那班已開走，現在等的是下一班。 */
export const NEXT_BUS_JUMP_MINUTES = 3;

/**
 * 導引變化要不要播報。只在情境改變時說一次：開始前往站牌、到站牌、公車快到（≤3 分）、進站（≤1 分）、
 * 上車、每少一站（最後一站改成「下一站請準備下車」）。分鐘數每輪更新只改畫面，不重複念。
 * `spoken` 記住這段公車已經提醒過的門檻，回傳要新增的鍵；等的那班開走、換成下一班（分鐘數明顯跳大）時
 * `reset` 為 true，呼叫端先清空再記，下一班車快到時會再提醒。
 */
export function transitAnnouncement(
  prev: TransitGuide | null,
  next: TransitGuide | null,
  spoken: ReadonlySet<string>,
): { speech: TransitSpeech | null; remember: string[]; reset?: boolean } {
  if (!next) return { speech: null, remember: [] };
  if (next.phase === "riding") {
    if (prev?.phase !== "riding") {
      if (spoken.has("boarded")) return { speech: null, remember: [] };
      return {
        speech: {
          kind: "boarded",
          alightStop: next.alightStop,
          stopsLeft: next.stopsLeft,
          minutes: next.minutes,
        },
        remember: [
          "boarded",
          ...(next.stopsLeft !== null ? [`stops:${next.stopsLeft}`] : []),
        ],
      };
    }
    if (
      next.stopsLeft === 0 &&
      prev.stopsLeft !== null &&
      prev.stopsLeft > 0 &&
      !spoken.has("alight")
    ) {
      return {
        speech: { kind: "alight", alightStop: next.alightStop },
        remember: ["alight", "stops:0"],
      };
    }
    if (
      next.stopsLeft !== null &&
      prev.stopsLeft !== null &&
      next.stopsLeft < prev.stopsLeft &&
      next.stopsLeft >= 1 &&
      !spoken.has(`stops:${next.stopsLeft}`)
    ) {
      return {
        speech:
          next.stopsLeft === 1
            ? { kind: "nextStopAlight", alightStop: next.alightStop }
            : {
                kind: "stopsLeft",
                alightStop: next.alightStop,
                stopsLeft: next.stopsLeft,
                minutes: next.minutes,
              },
        remember: [`stops:${next.stopsLeft}`],
      };
    }
    return { speech: null, remember: [] };
  }

  const wait = next.waitMinutes;
  // 剛開始前往站牌、或剛到站牌：說一次完整的情境，並把已經涵蓋的門檻記起來，接下來不重複。
  const covered = (minutes: number | null) => [
    ...(minutes !== null && minutes <= BUS_SOON_MINUTES ? ["soon"] : []),
    ...(minutes !== null && minutes <= BUS_ARRIVING_MINUTES
      ? ["arriving"]
      : []),
  ];
  if (
    next.phase === "approaching" &&
    prev === null &&
    !spoken.has("approach")
  ) {
    return {
      speech: {
        kind: "approach",
        routeName: next.routeName,
        boardStop: next.boardStop,
        waitMinutes: wait,
      },
      remember: ["approach"],
    };
  }
  if (
    next.phase === "waiting" &&
    prev?.phase !== "waiting" &&
    !spoken.has("atStop")
  ) {
    return {
      speech: {
        kind: "atStop",
        routeName: next.routeName,
        boardStop: next.boardStop,
        waitMinutes: wait,
      },
      remember: ["atStop", ...covered(wait)],
    };
  }
  if (next.phase !== "waiting" || wait === null)
    return { speech: null, remember: [] };
  const prevWait = prev?.phase === "waiting" ? prev.waitMinutes : null;
  if (prevWait !== null && wait > prevWait + NEXT_BUS_JUMP_MINUTES)
    return { speech: null, remember: [], reset: true };
  if (wait <= BUS_ARRIVING_MINUTES && !spoken.has("arriving")) {
    return {
      speech: { kind: "busArriving", routeName: next.routeName },
      remember: ["arriving", "soon"],
    };
  }
  if (wait <= BUS_SOON_MINUTES && !spoken.has("soon")) {
    return {
      speech: { kind: "busSoon", routeName: next.routeName, waitMinutes: wait },
      remember: ["soon"],
    };
  }
  return { speech: null, remember: [] };
}

/** 沿線速度（m/s）：兩個樣本的沿線距離差除以時間；時間太短或倒退回 null。 */
export function alongSpeedMps(
  prev: { alongM: number; at: number } | null,
  alongM: number,
  at: number,
): number | null {
  if (!prev) return null;
  const dt = (at - prev.at) / 1000;
  if (dt < 0.5) return null;
  return Math.max(0, alongM - prev.alongM) / dt;
}

/** 公車段起終點在串接路徑上的沿線距離。 */
export function legAlongRange(
  cp: CumulativePath,
  legIndex: number,
): { startM: number; endM: number } | null {
  const range = cp.legRanges[legIndex];
  if (!range || range.count === 0) return null;
  return {
    startM: cp.cumM[range.start] ?? 0,
    endM: cp.cumM[range.start + range.count - 1] ?? 0,
  };
}
