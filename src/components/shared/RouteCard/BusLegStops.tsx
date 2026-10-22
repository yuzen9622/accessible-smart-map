import { useMemo } from "react";
import { useBusLegStopEtas } from "@/hook/useBusLegStopEtas";
import { useAppTranslation } from "@/i18n/client";
import { getAppLanguage } from "@/i18n/language";
import type { RouteDetailStop } from "@/lib/api/transit";
import { legSourceName, nonemptyName } from "@/lib/route/sourceNames";
import {
  buildStopRows,
  busLegKey,
  fallbackStopRows,
  parseStatusLabel,
  resolveCurrentStopSeq,
  resolveLegRide,
  withPlannedStopNames,
} from "@/lib/transit/busLegStops";
import useMapStore from "@/stores/useMapStore";
import type { BusLeg } from "@/types/route";
import { getLegColor } from "@/types/route";
import { TransitStops } from "./TransitStops";

/** A stop's own timetable time, when the feed carries one instead of an ETA. */
function stopClock(stop?: RouteDetailStop) {
  const label = stop && parseStatusLabel(stop.statusLabel);
  return label?.kind === "scheduled" ? String(label.params?.time) : undefined;
}

export function BusLegStops({
  leg: rawLeg,
  routeToken,
  routeIndex,
  legIndex,
  isSelected,
  hidePlannedTimes = false,
  boardTime = hidePlannedTimes ? undefined : rawLeg.departureTime,
  alightTime = hidePlannedTimes ? undefined : rawLeg.arrivalTime,
  publicFeed = false,
  viewedPlate,
  boardEtaMinutes = null,
  alightEtaMinutes = null,
}: {
  leg: BusLeg;
  routeToken?: string;
  routeIndex: number;
  legIndex: number;
  isSelected: boolean;
  /** The timetable belongs to another service than the one being viewed. */
  hidePlannedTimes?: boolean;
  boardTime?: string;
  alightTime?: string;
  /** Another service than the plan's: it has no token, so read the public feed. */
  publicFeed?: boolean;
  /** The viewed departure's vehicle, the only one the public feed may track. */
  viewedPlate?: string;
  /** The viewed service's own live estimate, used when the stop feed has none. */
  boardEtaMinutes?: number | null;
  alightEtaMinutes?: number | null;
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
    false,
    publicFeed,
  );
  // The public feed times the line's next bus at each stop, not the departure
  // being viewed: that departure's own times arrive through the props.
  const ride = useMemo(() => {
    const resolved = resolveLegRide(directions ?? undefined, leg);
    return publicFeed && resolved
      ? {
          ...resolved,
          stops: resolved.stops.map((stop) => ({
            ...stop,
            estimateMinutes: null,
            statusLabel: "",
          })),
        }
      : resolved;
  }, [directions, leg, publicFeed]);
  const boardStop = ride?.stops[0];
  const alightStop = ride?.stops.at(-1);

  // The tracked vehicle is shared store state: only show it on the open leg,
  // and only when it runs the same direction/branch this leg resolved to.
  const targetBus = useMemo(() => {
    if (!isOpen || !ride || !Array.isArray(liveBusPositions)) return null;
    return (
      liveBusPositions.find(
        (b) =>
          b.isTarget &&
          (!publicFeed || b.plateNumb === viewedPlate) &&
          b.direction === ride.direction &&
          (!ride.subRouteUid ||
            !b.subRouteUid ||
            b.subRouteUid === ride.subRouteUid),
      ) ?? null
    );
  }, [isOpen, ride, liveBusPositions, publicFeed, viewedPlate]);

  const rows = useMemo(() => {
    if (!isOpen) return undefined;

    if (ride && ride.stops.length > 0) {
      const currentSeq = resolveCurrentStopSeq(ride.stops, targetBus);
      return withPlannedStopNames(
        buildStopRows(ride.stops, currentSeq),
        leg,
        language,
        !hidePlannedTimes,
      );
    }

    // A failed or unavailable lookup keeps the original planned stop times,
    // unless those times belong to another service than the one shown.
    const fallback = fallbackStopRows(leg, {
      pending: status === "idle" || status === "loading",
      language,
    });
    return hidePlannedTimes
      ? fallback.map((row) => ({ ...row, statusLabel: "" }))
      : fallback;
  }, [isOpen, ride, leg, targetBus, status, language, hidePlannedTimes]);

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
        boardTime={stopClock(boardStop) ?? boardTime}
        alightTime={stopClock(alightStop) ?? alightTime}
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
        liveEtaMinutes={boardStop?.estimateMinutes ?? boardEtaMinutes}
        alightLiveEtaMinutes={alightStop?.estimateMinutes ?? alightEtaMinutes}
      />
    </div>
  );
}
