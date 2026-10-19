import { type ReactNode, useState } from "react";
import { useAppTranslation } from "@/i18n/client";
import { getAppLanguage } from "@/i18n/language";
import { busLegKey } from "@/lib/transit/busLegStops";
import {
  formatRouteClock,
  resolveViewedCandidate,
} from "@/lib/transit/departureCandidates";
import useMapStore from "@/stores/useMapStore";
import { type BusLeg, getLegColor } from "@/types/route";
import { BusDepartureCandidates } from "./BusDepartureCandidates";
import { BusLegStops } from "./BusLegStops";
import { useBusCandidateInfo } from "./BusRouteBadges";

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
  const { t } = useAppTranslation();
  const [expanded, setExpanded] = useState(false);
  const activeKey = useMapStore((state) => state.activeBusLeg?.key);
  const key = busLegKey(`${routeIndex}:${legIndex}`, {
    ...rawLeg,
    planContext: routeToken ? { routeToken, legIndex } : undefined,
  });
  const [view, setView] = useState<{ key: string; id: string } | null>(null);
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
  const refreshed =
    refresh.departureCandidates !== undefined ||
    refresh.candidateSearchComplete !== undefined;
  const complete = refreshed
    ? refresh.candidateSearchComplete
    : rawLeg.candidateSearchComplete;

  const viewed = resolveViewedCandidate(
    candidates ?? [],
    view?.key === key ? view.id : undefined,
  );
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
          searchComplete={complete}
          viewedCandidateId={view?.key === key ? view.id : undefined}
          onViewCandidate={(id) => setView({ key, id })}
          onOpenChange={setExpanded}
          freshness={
            refresh.status === "error"
              ? "error"
              : refresh.status === "loading"
                ? "loading"
                : refresh.departureCandidates === undefined
                  ? "plan"
                  : "live"
          }
        />
      )}
      {candidates === undefined && complete === false && (
        <p
          role="status"
          className="text-xs text-muted-foreground"
          title={t("busCandidateSearchPartial")}
        >
          {t("busCandidatePartialShort")}
        </p>
      )}
      {differentFromPlan && (
        <p className="text-[11px] text-muted-foreground">
          {t("busCandidatePlannedStopsShort")}
        </p>
      )}
      <BusLegStops
        leg={rawLeg}
        hidePlannedTimes={Boolean(viewed && !differentFromPlan)}
        routeToken={routeToken}
        routeIndex={routeIndex}
        legIndex={legIndex}
        isSelected={isSelected}
      />
    </div>
  );
}
