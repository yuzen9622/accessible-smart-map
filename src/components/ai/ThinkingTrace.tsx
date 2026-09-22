"use client";

import { Check, ChevronDown, Sparkles } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { ThinkingOrb } from "thinking-orbs";
import useReducedMotion from "@/hook/useReducedMotion";
import { toolToOrbState } from "@/lib/ai/orbState";
import type { ThinkingHeader, TraceRow } from "@/lib/ai/thinkingTrace";
import { cn } from "@/lib/utils";

/**
 * AI 助理的思考／工具呼叫軌跡。
 *
 * 版面與動畫改寫自 Beautiful UI 的 Thinking 組件（MIT, © 2026 Shane Levine,
 * https://www.beautifului.dev — 見 AUTHORS.md）。原版是 landing page 的展示
 * 品：進度由寫死的 `useSequence([800, 600, 1800, 2600, 1600])` 推動，跑完 3.2
 * 秒就自動打勾，內容也是寫死的假資料。這裡拔掉那條假時間軸，改成完全由
 * `rows` / `header` 驅動——真實的工具跑 8 秒，trace 就顯示 8 秒。
 *
 * 配色同樣沒有沿用原版：它自帶一整套 `--ink` / `--line` design system，
 * 塞進來會跟本專案的 shadcn 主題與高對比模式打架，所以全部換成既有 token。
 */
export default function ThinkingTrace({
  rows,
  header,
  className,
}: {
  rows: TraceRow[];
  header: ThinkingHeader;
  className?: string;
}) {
  const reducedMotion = useReducedMotion();
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);

  // 思考中自動展開，落定後自動收合；使用者手動點過之後就一律聽使用者的。
  const autoExpanded = header.working;
  const expanded = manualExpanded ?? autoExpanded;

  // 左側那條連接線的高度要跟著內容長，不能用 100%：外層是 `grid-template-rows`
  // 0fr→1fr 的收合容器，收合時高度為 0，線會一起消失得很突兀。
  const traceRef = useRef<HTMLUListElement>(null);
  const [lineHeight, setLineHeight] = useState(0);
  useLayoutEffect(() => {
    if (traceRef.current) setLineHeight(traceRef.current.offsetHeight);
  }, []);
  useLayoutEffect(() => {
    if (!traceRef.current) return;
    const observer = new ResizeObserver(() => {
      if (traceRef.current) setLineHeight(traceRef.current.offsetHeight);
    });
    observer.observe(traceRef.current);
    return () => observer.disconnect();
  }, []);

  const runningRow = rows.find((r) => r.status === "running");
  const orbState = toolToOrbState(
    runningRow?.name ?? rows[rows.length - 1]?.name,
  );

  return (
    <div className={cn("flex w-full flex-col", className)}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() =>
          setManualExpanded((current) => !(current ?? autoExpanded))
        }
        disabled={rows.length === 0}
        className={cn(
          "-mx-1.5 flex w-fit items-center gap-2 rounded-md px-1.5 py-1 text-left",
          "transition-colors duration-100",
          rows.length > 0
            ? "hover:bg-muted/60 cursor-pointer"
            : "cursor-default",
        )}
      >
        <span className="flex shrink-0 items-center justify-center">
          {header.working ? (
            <ThinkingOrb
              state={orbState}
              // thinking-orbs 的 OrbSize 只開放 20 | 64
              size={20}
              role="img"
              aria-label={header.label}
              className="shrink-0"
            />
          ) : (
            // 落定後換成靜態 icon：舊訊息的 trace 會一直留在對話裡，讓每一則
            // 都掛一顆永遠轉動的 orb 既吵又浪費一條 rAF。
            <Sparkles
              className="h-4 w-4 text-muted-foreground/70"
              aria-hidden="true"
            />
          )}
        </span>

        <span
          role="status"
          aria-live="polite"
          className={cn(
            "text-[13px] font-medium whitespace-nowrap",
            header.working && !reducedMotion
              ? "thinking-shimmer bg-clip-text text-transparent"
              : "text-muted-foreground",
          )}
        >
          {header.label}
        </span>

        {rows.length > 0 && (
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground/70",
              !reducedMotion && "transition-transform duration-300",
              expanded && "rotate-180",
            )}
            aria-hidden="true"
          />
        )}
      </button>

      {/* 展開區：用 grid-template-rows 0fr→1fr 做高度動畫，不需要量測內容高度，
          也不會像 max-height 那樣在內容變長時被截斷。
          還沒有任何工具時整塊不渲染——空的 <ul> 仍有 py-1 的高度，連接線會
          在 orb 底下留一小截沒有接到任何東西的懸空線段。 */}
      {rows.length > 0 && (
        <div
          className="grid"
          style={{
            gridTemplateRows: expanded ? "1fr" : "0fr",
            opacity: expanded ? 1 : 0,
            transition: reducedMotion
              ? undefined
              : "grid-template-rows 400ms cubic-bezier(0.23,1,0.32,1), opacity 400ms cubic-bezier(0.23,1,0.32,1)",
          }}
        >
          <div className="overflow-hidden">
            <div className="relative mt-1 ml-[8px] pl-4">
              <span
                aria-hidden="true"
                className="absolute left-[3px] w-px bg-border"
                style={{
                  top: -6,
                  height: lineHeight ? lineHeight - 2 : 0,
                  transition: reducedMotion
                    ? undefined
                    : "height 500ms cubic-bezier(0.23,1,0.32,1)",
                }}
              />
              <ul ref={traceRef} className="flex flex-col gap-1 py-1">
                {rows.map((row, index) => (
                  <li
                    key={row.id}
                    className="flex min-h-7 w-full items-center gap-2 rounded-md px-1.5 py-0.5"
                    style={
                      reducedMotion
                        ? undefined
                        : {
                            animation: `thinking-row-in 320ms cubic-bezier(0.23,1,0.32,1) ${Math.min(index, 6) * 90}ms both`,
                          }
                    }
                  >
                    {row.status === "running" ? (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-3 shrink-0 rounded-full border-[1.5px] border-border border-t-foreground",
                          !reducedMotion && "animate-spin",
                        )}
                      />
                    ) : (
                      <Check
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                    {/* 兩截都要 `min-w-0 truncate`：flex item 預設 min-width
                        是 auto，少了 min-w-0 就縮不下去，少了 truncate 則會
                        被祖先的 overflow-hidden 硬切（沒有省略號）。
                        detail 的 shrink 給 3 倍，空間不夠時先犧牲補充說明、
                        保住工具名稱，而不是兩截一起變成半截。 */}
                    <span className="min-w-0 truncate text-[12.5px] font-medium text-foreground">
                      {row.label}
                    </span>
                    {row.detail && (
                      <span className="min-w-0 shrink-[3] truncate text-[11.5px] text-muted-foreground">
                        {row.detail}
                      </span>
                    )}
                    <span className="sr-only">
                      {row.status === "running" ? "進行中" : "已完成"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
