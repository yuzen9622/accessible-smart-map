import type { ToolActivity } from "@/stores/useChatStore";
import { toolDoneLabel, toolLoadingLabel } from "./toolLabels";

/**
 * `ToolActivity[]`（串流過程中累積的工具呼叫）→ Thinking trace 要畫的資料。
 *
 * 判斷全部留在這裡而不寫進 `ThinkingTrace.tsx`，是因為 vitest 跑在 node
 * 環境、渲染不了元件（見 memory「測試不可測『複製品』」）。元件只負責把
 * 這裡算好的 rows 與 header 畫出來。
 */

export type TraceRowStatus = "running" | "done";

export type TraceRow = {
  /** React key。同一個工具可能被連續呼叫多次，所以帶上索引才唯一。 */
  id: string;
  /** 原始工具名稱——元件用它挑 orb 狀態。 */
  name: string;
  /** 「查詢公車路線」。進行中與已完成共用同一份文字，狀態靠 icon 表達。 */
  label: string;
  /** 從 args 抽出的一句話補充，例如「台北車站 → 台北101」。 */
  detail?: string;
  status: TraceRowStatus;
};

export type ThinkingHeader = {
  /** true 時元件跑 shimmer；false 時是已落定的摘要。 */
  working: boolean;
  label: string;
};

/** detail 太長會把 row 撐爆，也蓋掉右側的狀態；截在這個長度。 */
const DETAIL_MAX = 22;

/**
 * 依序嘗試這些 key。順序＝後端 `src/config/ai/tool.ts` 裡最能代表「這次查了什麼」
 * 的參數：先找地點/關鍵字，再退回路線與車站。
 */
const DETAIL_KEYS = [
  "query",
  "routeName",
  "stopName",
  "campusId",
  "originStation",
  "destinationStation",
  "content",
] as const;

/** `origin: 'current_location'` 是後端約定的哨兵值，不是地名。 */
const CURRENT_LOCATION = "current_location";

function truncate(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= DETAIL_MAX) return trimmed;
  return `${trimmed.slice(0, DETAIL_MAX - 1)}…`;
}

/**
 * `ToolActivity.args` 在 `streamChatWithAgent` 裡一律被轉成 JSON 字串再往上
 * 傳，但型別上是 `unknown`，所以兩種形狀都要收。解析失敗回 `null`——工具照
 * 常顯示，只是沒有補充說明。
 */
function parseArgs(args: unknown): Record<string, unknown> | null {
  if (typeof args === "string") {
    if (!args.trim()) return null;
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  if (args && typeof args === "object") {
    return args as Record<string, unknown>;
  }
  return null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 從工具參數擠出一句人看得懂的補充。起訖點優先（路線類工具最有資訊量），
 * 其次是 `DETAIL_KEYS`。抽不到就回 `undefined`，row 只顯示工具名稱。
 */
export function summarizeToolArgs(args: unknown): string | undefined {
  const parsed = parseArgs(args);
  if (!parsed) return undefined;

  const origin = readString(parsed.origin);
  const destination = readString(parsed.destination);
  if (origin || destination) {
    const from = origin === CURRENT_LOCATION ? "目前位置" : origin;
    if (from && destination) return truncate(`${from} → ${destination}`);
    return truncate((destination ?? from) as string);
  }

  for (const key of DETAIL_KEYS) {
    const value = readString(parsed[key]);
    if (value) return truncate(value);
  }
  return undefined;
}

/** 工具呼叫串 → trace 的每一列。順序即發生順序。 */
export function buildTraceRows(activities: ToolActivity[]): TraceRow[] {
  return activities.map((activity, index) => ({
    id: `${activity.name}-${index}`,
    name: activity.name,
    label: toolDoneLabel(activity.name),
    detail: summarizeToolArgs(activity.args),
    status: activity.status,
  }));
}

/**
 * 耗時字串。刻意不用「4.0 秒」這種尾數——整數就寫整數。
 */
export function formatThinkingDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return "不到 1 秒";
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    const rounded = Math.round(totalSeconds * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} 秒`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
}

/**
 * Trace 標題。
 *
 * `working` 的定義刻意與改版前的 `showLoading` 一致：有工具在跑，或還沒吐出
 * 任何文字。一旦答覆開始串流且沒有工具在跑，標題就落定成摘要——否則使用者
 * 會看到一個一邊閃、一邊底下已經有完整答案的矛盾狀態。
 */
export function describeThinking({
  activities,
  isStreaming,
  hasContent,
  thinkingMs,
}: {
  activities: ToolActivity[];
  isStreaming: boolean;
  hasContent: boolean;
  thinkingMs?: number;
}): ThinkingHeader {
  const running = activities.find((a) => a.status === "running");
  const working = isStreaming && (!hasContent || !!running);

  if (working) {
    if (running) return { working, label: toolLoadingLabel(running.name) };
    if (activities.length) return { working, label: "正在整理答覆…" };
    return { working, label: "思考中…" };
  }

  const duration =
    thinkingMs === undefined ? "" : formatThinkingDuration(thinkingMs);
  const base = activities.length
    ? `已完成 ${activities.length} 項查詢`
    : "已完成思考";
  return { working, label: duration ? `${base} · ${duration}` : base };
}

/**
 * Trace 該不該出現。沒有工具、也不在思考中（例如開場白、或純文字回答結束後）
 * 就整塊不渲染，避免每則訊息上方都掛一條空的「已完成思考」。
 */
export function shouldShowTrace({
  activities,
  header,
}: {
  activities: ToolActivity[];
  header: ThinkingHeader;
}): boolean {
  return activities.length > 0 || header.working;
}
