import type { BusLegEtaStatus } from "@/hook/useBusLegStopEtas";
import { useAppTranslation } from "@/i18n/client";
import type { BusLegStopRow, EtaTone } from "@/lib/transit/busLegStops";
import { resolveEtaLabel } from "@/lib/transit/busLegStops";
import { cn } from "@/lib/utils";
import type { IntermediateStop, SlimOsmA11y } from "@/types/route";
import { A11yStationIcons } from "./A11yStationIcons";
import { IntermediateStops } from "./IntermediateStops";

function BoardAlightEtaBadge({
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
        "text-[11px] px-1.5 py-0.5 rounded-full tabular-nums shrink-0 select-none ml-auto",
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
}) {
  const { t } = useAppTranslation();

  const boardRow = rows && rows.length > 0 ? rows[0] : undefined;
  const alightRow = rows && rows.length > 1 ? rows[rows.length - 1] : undefined;
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
        {boardTime && (
          <span className="text-muted-foreground">{boardTime}</span>
        )}
        {boardRow && isStopsOpen && (
          <BoardAlightEtaBadge row={boardRow} t={t} />
        )}
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
        {alightTime && (
          <span className="text-muted-foreground">{alightTime}</span>
        )}
        {alightRow && isStopsOpen && (
          <BoardAlightEtaBadge row={alightRow} t={t} />
        )}
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
