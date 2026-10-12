import { useMemo } from "react";
import { useBusLegStopEtas } from "@/hook/useBusLegStopEtas";
import { useAppTranslation } from "@/i18n/client";
import { getAppLanguage } from "@/i18n/language";
import { legSourceName, nonemptyName } from "@/lib/route/sourceNames";
import {
  buildStopRows,
  busLegKey,
  fallbackStopRows,
  resolveCurrentStopSeq,
  resolveLegRide,
  withPlannedStopNames,
} from "@/lib/transit/busLegStops";
import useMapStore from "@/stores/useMapStore";
import type { BusLeg } from "@/types/route";
import { getLegColor } from "@/types/route";
import { TransitStops } from "./TransitStops";

export function BusLegStops({
  leg: rawLeg,
  routeToken,
  routeIndex,
  legIndex,
  isSelected,
}: {
  leg: BusLeg;
  routeToken?: string;
  routeIndex: number;
  legIndex: number;
  isSelected: boolean;
}) {
  const { t } = useAppTranslation();
  const language = getAppLanguage();
  const leg = useMemo(
    () => ({
      ...rawLeg,
      planContext: routeToken ? { routeToken, legIndex } : undefined,
    }),
    [rawLeg, routeToken, legIndex],
  );
  const key = busLegKey(`${routeIndex}:${legIndex}`, leg);

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
  const ride = useMemo(
    () => resolveLegRide(directions ?? undefined, leg),
    [directions, leg],
  );

  // The tracked vehicle is shared store state: only show it on the open leg,
  // and only when it runs the same direction/branch this leg resolved to.
  const targetBus = useMemo(() => {
    if (!isOpen || !ride || !Array.isArray(liveBusPositions)) return null;
    return (
      liveBusPositions.find(
        (b) =>
          b.isTarget &&
          b.direction === ride.direction &&
          (!ride.subRouteUid ||
            !b.subRouteUid ||
            b.subRouteUid === ride.subRouteUid),
      ) ?? null
    );
  }, [isOpen, ride, liveBusPositions]);

  const rows = useMemo(() => {
    if (!isOpen) return undefined;

    if (ride && ride.stops.length > 0) {
      const currentSeq = resolveCurrentStopSeq(ride.stops, targetBus);
      return withPlannedStopNames(
        buildStopRows(ride.stops, currentSeq),
        leg,
        language,
      );
    }

    // A failed or unavailable lookup keeps the original planned stop times.
    return fallbackStopRows(leg, {
      pending: status === "idle" || status === "loading",
      language,
    });
  }, [isOpen, ride, leg, targetBus, status, language]);

  const currentStop = rows?.find((r) => r.state === "current");
  const currentStopName =
    nonemptyName(currentStop?.displayName) || currentStop?.name;

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
        boardName={legSourceName(
          leg,
          "from",
          leg.departureStop,
          getAppLanguage(),
        )}
        alightName={legSourceName(leg, "to", leg.arrivalStop, getAppLanguage())}
        displayLanguage={leg.displayLanguage}
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
        liveEtaMinutes={isOpen ? ride?.stops[0]?.estimateMinutes : null}
        alightLiveEtaMinutes={
          isOpen ? ride?.stops.at(-1)?.estimateMinutes : null
        }
      />
    </div>
  );
}
