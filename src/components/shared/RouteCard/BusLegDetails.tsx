import { type ReactNode, useState } from "react";
import { useAppTranslation } from "@/i18n/client";
import { getAppLanguage } from "@/i18n/language";
import { busLegKey } from "@/lib/transit/busLegStops";
import {
  followCandidate,
  formatRouteClock,
  resolveViewedCandidate,
} from "@/lib/transit/departureCandidates";
import { adoptBusDeparture } from "@/lib/transit/selectDeparture";
import useMapStore from "@/stores/useMapStore";
import {
  type BusDepartureCandidate,
  type BusLeg,
  getLegColor,
} from "@/types/route";
import { BusDepartureCandidates } from "./BusDepartureCandidates";
import { BusLegStops } from "./BusLegStops";
import { useBusCandidateInfo } from "./BusRouteBadges";

const wholeMinutes = (minutes: number | null) =>
  minutes === null ? null : Math.max(0, Math.round(minutes));

function minutesUntil(instant: string | null) {
  const ms = instant ? Date.parse(instant) - Date.now() : Number.NaN;
  return Number.isFinite(ms) ? wholeMinutes(ms / 60_000) : null;
}

/** The planned leg re-pointed at another service, for its own stop feed. */
function viewedLeg(leg: BusLeg, viewed: BusDepartureCandidate): BusLeg {
  return {
    ...leg,
    routeName: viewed.routeName,
    // The candidate's sub-route name is display text, not the TDX query name.
    subRouteName: undefined,
    subRouteUid: viewed.subRouteUid,
    direction: viewed.direction,
    scheduledTrip: undefined,
  };
}

export function BusLegDetails({
  leg: rawLeg,
  routeToken,
  routeIndex,
  legIndex,
  isSelected,
  children,
}: {
  leg: BusLeg;
  routeToken?: string;
  routeIndex: number;
  legIndex: number;
  isSelected: boolean;
  children: ReactNode;
}) {
  const { t } = useAppTranslation();
  const selection = useMapStore((state) => state.busSelection);
  const isNavigating = useMapStore((state) => state.isNavigating);
  const pending = selection?.status === "pending";
  const selectionForLeg =
    selection?.routeToken === routeToken && selection?.legIndex === legIndex
      ? selection
      : null;
  const activeKey = useMapStore((state) => state.activeBusLeg?.key);
  const key = busLegKey(`${routeIndex}:${legIndex}`, {
    ...rawLeg,
    planContext: routeToken ? { routeToken, legIndex } : undefined,
  });
  const [view, setView] = useState<{
    key: string;
    candidate: BusDepartureCandidate;
  } | null>(null);
  const { refresh } = useBusCandidateInfo(
    rawLeg,
    routeToken,
    legIndex,
    isSelected,
    // The stop list already polls this key when open. Share its snapshot
    // instead of creating a second forced polling loop for the same leg.
    isSelected && activeKey !== key,
  );
  const candidates = refresh.departureCandidates ?? rawLeg.departureCandidates;

  const followed =
    view?.key === key
      ? followCandidate(candidates ?? [], view.candidate)
      : undefined;
  const viewed = resolveViewedCandidate(
    candidates ?? [],
    followed?.candidateId,
  );
  const viewedClock = (instant?: string | null) =>
    instant ? formatRouteClock(instant, getAppLanguage()) : null;
  const viewingAdopted = !viewed || viewed.selected;
  const differentFromPlan =
    viewed &&
    (!viewed.selected ||
      (rawLeg.subRouteUid && viewed.subRouteUid !== rawLeg.subRouteUid) ||
      (rawLeg.scheduledTrip && viewed.tripId !== rawLeg.scheduledTrip.tripId) ||
      (rawLeg.departureTime &&
        formatRouteClock(viewed.boardingTime, getAppLanguage()) !==
          rawLeg.departureTime));

  return (
    <div className="space-y-1 min-w-0">
      {!viewed && children}
      {candidates !== undefined && (
        <BusDepartureCandidates
          candidates={candidates}
          color={getLegColor(rawLeg)}
          viewedCandidateId={followed?.candidateId}
          disabled={!isSelected || !routeToken || pending || isNavigating}
          selecting={selectionForLeg?.status === "pending"}
          onViewCandidate={(id) => {
            const candidate = candidates.find((c) => c.candidateId === id);
            if (candidate && routeToken) {
              setView({ key, candidate });
              void adoptBusDeparture(routeToken, legIndex, id);
            }
          }}
        />
      )}
      {selectionForLeg?.status === "error" && routeToken && (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
          role="alert"
        >
          <span className="text-destructive">
            {t("busCandidateSelectionFailed")}
          </span>
          <button
            type="button"
            className="min-h-9 px-1 font-medium text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() =>
              void adoptBusDeparture(
                routeToken,
                legIndex,
                selectionForLeg.candidateId,
              )
            }
          >
            {t("retry")}
          </button>
        </div>
      )}
      <BusLegStops
        leg={viewingAdopted ? rawLeg : viewedLeg(rawLeg, viewed)}
        hidePlannedTimes={Boolean(differentFromPlan)}
        boardTime={viewedClock(viewed?.boardingTime) ?? undefined}
        alightTime={viewedClock(viewed?.alightingTime) ?? undefined}
        boardEtaMinutes={
          viewed?.boardingTimeSource === "realtime"
            ? (wholeMinutes(viewed.estimatedWaitMinutes) ??
              minutesUntil(viewed.boardingTime))
            : null
        }
        alightEtaMinutes={
          viewed?.alightingTimeSource === "realtime"
            ? minutesUntil(viewed.alightingTime)
            : null
        }
        routeToken={viewingAdopted ? routeToken : undefined}
        publicFeed={!viewingAdopted}
        viewedPlate={viewed?.plateNumb}
        routeIndex={routeIndex}
        legIndex={legIndex}
        isSelected={isSelected}
      />
    </div>
  );
}
