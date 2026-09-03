import { BusIcon, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import type { BusLegEtaStatus } from "@/hook/useBusLegStopEtas";
import { useAppTranslation } from "@/i18n/client";
import type { BusLegStopRow, EtaTone } from "@/lib/transit/busLegStops";
import { resolveEtaLabel } from "@/lib/transit/busLegStops";
import { cn } from "@/lib/utils";
import type { IntermediateStop } from "@/types/route";

function EtaBadge({
  row,
  t,
}: {
  row: BusLegStopRow;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { key, tone, count } = resolveEtaLabel(row);
  const labelText = count !== undefined ? t(key, { count }) : t(key);

  const toneClasses: Record<EtaTone, string> = {
    arriving: "text-red-600 dark:text-red-400 bg-red-500/10 font-bold",
    soon: "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 font-medium",
    normal: "text-muted-foreground bg-muted/60",
    muted: "text-muted-foreground/70 bg-transparent",
  };

  return (
    <span
      className={cn(
        "text-[11px] px-1.5 py-0.5 rounded-full tabular-nums shrink-0 select-none",
        toneClasses[tone],
      )}
    >
      <span
        key={labelText}
        className="animate-in fade-in duration-300 motion-reduce:animate-none"
      >
        {labelText}
      </span>
    </span>
  );
}

export function IntermediateStops({
  stops,
  rows,
  color,
  etaStatus,
  open,
  onOpenChange,
  targetPlate,
}: {
  stops?: IntermediateStop[];
  rows?: BusLegStopRow[];
  color: string;
  etaStatus?: BusLegEtaStatus;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  targetPlate?: string;
}) {
  const { t } = useAppTranslation();
  const [uncontrolled, setUncontrolled] = useState(false);
  const listId = useId();

  const isOpen = open ?? uncontrolled;

  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  };

  const totalCount = rows?.length ?? stops?.length ?? 0;
  if (totalCount === 0) return null;

  return (
    <div className="my-1.5 ml-2.5">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-controls={listId}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 px-2 py-2.5 lg:py-1 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 transition-transform duration-200 ease-out motion-reduce:transition-none",
            isOpen && "rotate-180",
          )}
        />
        <span>{t("passStops", { count: totalCount })}</span>
      </button>

      <div
        id={listId}
        aria-hidden={!isOpen}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="pl-3.5 my-2 space-y-2 border-l border-muted-foreground/30 ml-3.5">
            {etaStatus === "loading" && (!rows || rows.length === 0) && (
              <div className="space-y-2 py-1">
                <div className="h-3 w-24 rounded bg-muted animate-pulse motion-reduce:animate-none" />
                <div className="h-3 w-32 rounded bg-muted animate-pulse motion-reduce:animate-none" />
                <div className="h-3 w-28 rounded bg-muted animate-pulse motion-reduce:animate-none" />
                <span className="sr-only">{t("busEtaLoading")}</span>
              </div>
            )}

            {etaStatus === "error" && (!rows || rows.length === 0) && (
              <div className="text-xs text-muted-foreground py-1">
                {t("busEtaError")}
              </div>
            )}

            {rows && rows.length > 0 ? (
              <div className="space-y-2">
                {rows.map((row) => {
                  const isPassed = row.state === "passed";
                  const isCurrent = row.state === "current";

                  // 使用固定的 key（以站點序號或名稱），避免資料更新時整個 DOM 重建重新觸發進場動畫
                  return (
                    <div
                      key={row.stationUid || `${row.seq}-${row.name}`}
                      className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5 text-xs text-muted-foreground relative"
                    >
                      {/* 狀態點 */}
                      <div className="relative flex items-center justify-center shrink-0 w-3 h-3">
                        {isCurrent ? (
                          <>
                            <span
                              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:animate-none"
                              style={{ backgroundColor: color }}
                            />
                            <div
                              className="w-2.5 h-2.5 rounded-full border border-background shadow-xs relative"
                              style={{ backgroundColor: color }}
                            />
                          </>
                        ) : isPassed ? (
                          <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 border border-background" />
                        ) : (
                          <div
                            className="w-1.5 h-1.5 rounded-full border border-background"
                            style={{ backgroundColor: color }}
                          />
                        )}
                      </div>

                      {/* 站名 */}
                      <div className="flex items-center gap-1.5 min-w-0 pr-1">
                        <span
                          className={cn(
                            "truncate",
                            isPassed &&
                              "line-through opacity-50 text-muted-foreground",
                            isCurrent && "font-semibold text-foreground",
                          )}
                        >
                          {row.name}
                        </span>
                        {isCurrent && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-foreground bg-muted/80 px-1 py-0.5 rounded font-mono shrink-0">
                            <BusIcon className="h-2.5 w-2.5" />
                            {targetPlate}
                          </span>
                        )}
                      </div>

                      {/* ETA Badge */}
                      <EtaBadge row={row} t={t} />
                    </div>
                  );
                })}
              </div>
            ) : stops && stops.length > 0 ? (
              stops.map((stop) => (
                <div
                  key={stop.stationUid || stop.name}
                  className="flex items-center gap-2.5 text-xs text-muted-foreground relative"
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full shrink-0 border border-background"
                    style={{ backgroundColor: color }}
                  />
                  <span>{stop.name}</span>
                </div>
              ))
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
