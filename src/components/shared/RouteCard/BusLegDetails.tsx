import { type ReactNode, useState } from "react";
import { getAppLanguage } from "@/i18n/language";
import { busLegKey } from "@/lib/transit/busLegStops";
import {
  followCandidate,
  formatRouteClock,
  resolveViewedCandidate,
} from "@/lib/transit/departureCandidates";
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

/** A local information view; never writes a candidate into the planned leg/store. */
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
  const [expanded, setExpanded] = useState(false);
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
    isSelected && (expanded || view?.key === key) && activeKey !== key,
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
          onViewCandidate={(id) => {
            const candidate = candidates.find((c) => c.candidateId === id);
            if (candidate) setView({ key, candidate });
          }}
          onOpenChange={setExpanded}
        />
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
