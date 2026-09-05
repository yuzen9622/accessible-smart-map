import type { BusLegEtaStatus } from "@/hook/useBusLegStopEtas";
import { useAppTranslation } from "@/i18n/client";
import type { BusLegStopRow } from "@/lib/transit/busLegStops";
import { cn } from "@/lib/utils";
import type { IntermediateStop, SlimOsmA11y } from "@/types/route";
import { A11yStationIcons } from "./A11yStationIcons";
import { IntermediateStops } from "./IntermediateStops";

function EndpointTime({
  scheduledTime,
  liveEtaMinutes,
  t,
}: {
  scheduledTime?: string;
  liveEtaMinutes?: number | null;
  t: (key: string, options?: Record<string, string | number>) => string;
}) {
  const hasLiveEta = typeof liveEtaMinutes === "number" && liveEtaMinutes >= 0;

  if (!hasLiveEta) {
    if (!scheduledTime) return null;
    return (
      <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
        {t("busPlannedAt", { time: scheduledTime })}
      </span>
    );
  }

  const key =
    liveEtaMinutes === 0
      ? "busRealtimeArriving"
      : liveEtaMinutes < 3
        ? "busRealtimeSoon"
        : "busRealtimeMinutes";
  const labelText = t(key, { count: liveEtaMinutes });

  return (
    <span
      aria-live="polite"
      className={cn(
        "text-[11px] px-1.5 py-0.5 rounded-full tabular-nums shrink-0 select-none ml-auto",
        liveEtaMinutes < 3
          ? "text-red-600 dark:text-red-400 bg-red-500/10 font-bold"
          : liveEtaMinutes < 10
            ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 font-medium"
            : "text-muted-foreground bg-muted/60",
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

export function TransitStops({
  boardName,
  alightName,
  boardTime,
  alightTime,
  intermediateStops,
  color,
  departureA11y,
  arrivalA11y,
  isSelected,
  rows,
  etaStatus,
  isStopsOpen,
  onStopsOpenChange,
  targetPlate,
  liveEtaMinutes,
}: {
  boardName?: string;
  alightName?: string;
  boardTime?: string;
  alightTime?: string;
  intermediateStops?: IntermediateStop[];
  color: string;
  departureA11y?: SlimOsmA11y[];
  arrivalA11y?: SlimOsmA11y[];
  isSelected?: boolean;
  rows?: BusLegStopRow[];
  etaStatus?: BusLegEtaStatus;
  isStopsOpen?: boolean;
  onStopsOpenChange?: (open: boolean) => void;
  targetPlate?: string;
  /** ETA tied to the exact vehicle named by the boarding-stop arrival feed. */
  liveEtaMinutes?: number | null;
}) {
  const { t } = useAppTranslation();

  const intermediateRows =
    rows && rows.length > 2 ? rows.slice(1, -1) : undefined;

  return (
    <div className="space-y-1 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground shrink-0">
          {t("board")}
          {t("labelColon")}
        </span>
        <span className="font-medium">{boardName}</span>
        <EndpointTime
          scheduledTime={boardTime}
          liveEtaMinutes={isStopsOpen ? liveEtaMinutes : undefined}
          t={t}
        />
      </div>
      {isSelected && (
        <A11yStationIcons
          items={departureA11y}
          ariaLabel={t("departureA11yLabel") ?? "出發站無障礙設施"}
        />
      )}
      <IntermediateStops
        stops={intermediateStops}
        rows={intermediateRows}
        color={color}
        etaStatus={etaStatus}
        open={isStopsOpen}
        onOpenChange={onStopsOpenChange}
        targetPlate={targetPlate}
      />
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground shrink-0">
          {t("alight")}
          {t("labelColon")}
        </span>
        <span className="font-medium">{alightName}</span>
        <EndpointTime scheduledTime={alightTime} t={t} />
      </div>
      {isSelected && (
        <A11yStationIcons
          items={arrivalA11y}
          ariaLabel={t("arrivalA11yLabel") ?? "到達站無障礙設施"}
        />
      )}
    </div>
  );
}
