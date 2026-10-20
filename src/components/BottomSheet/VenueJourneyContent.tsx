"use client";

import { Square, X } from "lucide-react";
import { useAppTranslation } from "@/i18n/client";
import type { VenueJourney } from "@/lib/indoor/journey";
import { isVenueTourAllowed } from "@/lib/indoor/tour";
import {
  confirmVenueArrival,
  startVenueApproach,
  stopNavigation,
  venueApproachRouteKind,
} from "@/lib/navigation/navigationLifecycle";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute } from "@/types/route";
import VenueRouteSteps from "../shared/VenueRouteSteps";
import { Button } from "../ui/button";

function approachFor(journey: VenueJourney, route?: AccessibleRoute) {
  return route?.routeToken
    ? journey.outdoor?.approachRoutes?.[route.routeToken]
    : undefined;
}

/** Arrival here completes an outdoor leg, not the final indoor destination. */
export function venueOutdoorArrivalCopy(
  journey: VenueJourney | null,
  language = "zh-TW",
) {
  if (!journey?.outdoor || journey.guidance.status !== "outdoor") return null;
  const primary =
    journey.outdoor.routes[
      journey.outdoor.navigationIndex ?? journey.outdoor.selectedIndex
    ];
  const needsApproach =
    journey.outdoor.phase !== "approach" &&
    Boolean(approachFor(journey, primary));
  const needsDropOff =
    needsApproach && venueApproachRouteKind(primary) === "vehicle";
  const english = language.startsWith("en");
  return {
    needsApproach,
    needsDropOff,
    title: needsDropOff
      ? english
        ? "You have reached the drop-off point"
        : "已到下車點"
      : needsApproach
        ? english
          ? "Continue walking to the campus entrance"
          : "繼續步行前往校門"
        : english
          ? "Near the campus entrance"
          : "接近校門",
    description: needsApproach
      ? english
        ? `Continue on foot to ${journey.outdoor.arrival.name}, then follow the campus route to ${journey.to.name}.`
        : `${needsDropOff ? "請下車後" : "請繼續"}沿步行路線前往 ${journey.outdoor.arrival.name}，再接續校內路線至 ${journey.to.name}。`
      : english
        ? `At ${journey.outdoor.arrival.name}, continue campus guidance to ${journey.to.name}.`
        : `到達 ${journey.outdoor.arrival.name} 後，接續校內引導前往 ${journey.to.name}。`,
    actionLabel: needsApproach
      ? english
        ? "Continue on foot to the campus entrance"
        : needsDropOff
          ? "已下車，繼續前往校門"
          : "繼續步行前往校門"
      : english
        ? "Continue campus guidance"
        : "接續校內引導",
  };
}

export function VenueArrivalConfirmation({
  inHud = false,
  language = "zh-TW",
}: {
  inHud?: boolean;
  language?: string;
}) {
  const journey = useMapStore((s) => s.venueJourney);
  const arrived = useNavStore((s) => s.arrived);
  const copy = venueOutdoorArrivalCopy(journey, language);
  if (!arrived || !copy || !journey?.outdoor) return null;
  return (
    <div
      className={
        inHud
          ? "space-y-3"
          : "rounded-xl border border-primary/25 bg-primary/5 p-4 space-y-3"
      }
    >
      <p className="font-semibold">{copy.title}</p>
      <p className="text-sm text-muted-foreground">{copy.description}</p>
      <Button
        className="w-full"
        onClick={copy.needsApproach ? startVenueApproach : confirmVenueArrival}
      >
        {copy.actionLabel}
      </Button>
    </div>
  );
}

/** The step list behind the map-first HUD's list button. */
export default function VenueJourneyContent() {
  const { t } = useAppTranslation();
  const journey = useMapStore((s) => s.venueJourney);
  const setStepListOpen = useNavStore((s) => s.setStepListOpen);
  if (!journey) return null;
  return (
    <div className="space-y-4" data-venue-journey={journey.id}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold">
            {t("venueHeadingTo", { destination: journey.to.name })}
          </h2>
          <p className="text-sm text-muted-foreground">
            {[journey.to.buildingName, journey.to.levelRef]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {/* Phones hide the HUD bar, and its list toggle, under this sheet. */}
        <button
          type="button"
          onClick={() => setStepListOpen(false)}
          aria-label={t("close")}
          className="lg:hidden -mr-2 h-11 w-11 shrink-0 rounded-full flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      {!isVenueTourAllowed(journey.route) && (
        <p className="text-sm text-muted-foreground">
          {t("venueTourUnavailable")}
        </p>
      )}
      <VenueRouteSteps journey={journey} showArrival />
      <Button
        variant="outline"
        className="w-full gap-2"
        onClick={stopNavigation}
      >
        <Square className="h-4 w-4" />
        {t("endNav")}
      </Button>
    </div>
  );
}
