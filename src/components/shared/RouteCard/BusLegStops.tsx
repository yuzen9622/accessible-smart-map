import { useMemo } from "react";
import { useBusLegStopEtas } from "@/hook/useBusLegStopEtas";
import { useAppTranslation } from "@/i18n/client";
import {
  buildStopRows,
  fallbackStopRows,
  resolveCurrentStopSeq,
  resolveLegStops,
} from "@/lib/transit/busLegStops";
import useMapStore from "@/stores/useMapStore";
import type { BusLeg } from "@/types/route";
import { getLegColor } from "@/types/route";
import { TransitStops } from "./TransitStops";

export function BusLegStops({
  leg,
  routeIndex,
  legIndex,
  isSelected,
}: {
  leg: BusLeg;
  routeIndex: number;
  legIndex: number;
  isSelected: boolean;
}) {
  const { t } = useAppTranslation();
  const key = `${routeIndex}:${legIndex}:${leg.routeName}:${leg.direction}:${leg.departureStop}`;

  const activeBusLeg = useMapStore((s) => s.activeBusLeg);
  const setActiveBusLeg = useMapStore((s) => s.setActiveBusLeg);
  const liveBusPositions = useMapStore((s) => s.liveBusPositions);

  const isOpen = activeBusLeg?.key === key;

  const handleOpenChange = (open: boolean) => {
    setActiveBusLeg(open ? { key, leg } : null);
  };

  // Selected is enough to warm the ETAs; only expanding starts the poll. The
  // stop list is therefore already populated on the first render after the
  // user opens it, instead of showing placeholder rows for a beat.
  const { directions, status } = useBusLegStopEtas(
    leg,
    isSelected || isOpen,
    isOpen,
  );
  const targetBus = Array.isArray(liveBusPositions)
    ? (liveBusPositions.find((b) => b.isTarget) ?? null)
    : null;

  const rows = useMemo(() => {
    if (!isOpen) return undefined;

    const sliced = resolveLegStops(directions ?? undefined, leg);
    if (sliced && sliced.length > 0) {
      const currentSeq = resolveCurrentStopSeq(sliced, targetBus);
      return buildStopRows(sliced, currentSeq);
    }

    // No ETAs to attach: placeholders while the lookup runs, "no information"
    // once it has settled — never a service status we cannot back up.
    return fallbackStopRows(leg, {
      pending: status === "idle" || status === "loading",
    });
  }, [isOpen, directions, leg, targetBus, status]);

  const currentStopName = rows?.find((r) => r.state === "current")?.name;

  return (
    <div className="space-y-1">
      {isOpen && targetBus?.plateNumb && (
        <div
          aria-live="polite"
          className="text-[11px] text-muted-foreground flex items-center gap-1.5 px-0.5 animate-in fade-in duration-200"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span>{t("busLiveTracking")}</span>
          <span className="font-mono font-medium text-foreground">
            {targetBus.plateNumb}
          </span>
          {currentStopName && (
            <span className="truncate">
              {t("busCurrentStopAt", { stop: currentStopName })}
            </span>
          )}
        </div>
      )}

      <TransitStops
        boardName={leg.departureStop}
        alightName={leg.arrivalStop}
        boardTime={leg.departureTime}
        alightTime={leg.arrivalTime}
        intermediateStops={leg.intermediateStops}
        color={getLegColor(leg)}
        departureA11y={leg.departureStopA11y}
        arrivalA11y={leg.arrivalStopA11y}
        isSelected={isSelected}
        rows={rows}
        etaStatus={status}
        isStopsOpen={isOpen}
        onStopsOpenChange={handleOpenChange}
        targetPlate={targetBus?.plateNumb}
      />
    </div>
  );
}
