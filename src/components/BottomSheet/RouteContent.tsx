"use client";

import type { TFunction } from "i18next";
import {
  AlertTriangle,
  ArrowLeft,
  Cloud,
  Navigation,
  Sparkles,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useShallow } from "zustand/react/shallow";
import { useAppTranslation } from "@/i18n/client";
import type { VenueJourney } from "@/lib/indoor/journey";
import {
  startNavigation,
  venueApproachRouteKind,
} from "@/lib/navigation/navigationLifecycle";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute } from "@/types/route";
import LoadingDrawer from "../shared/LoadingDrawer";
import { RouteCard } from "../shared/RouteCard";
import {
  VenueWalkSteps,
  VenueWalkSummary,
} from "../shared/RouteCard/VenueWalkContinuation";
import VenueRouteSteps from "../shared/VenueRouteSteps";
import { Button } from "../ui/button";
import {
  EnvironmentSkeleton,
  HazardReportSkeleton,
  PanelSkeleton,
} from "./PanelSkeletons";

const EnvironmentPanel = dynamic(() => import("./EnvironmentPanel"), {
  loading: () => <EnvironmentSkeleton />,
  ssr: false,
});
const HazardReportPanel = dynamic(() => import("./HazardReportPanel"), {
  loading: () => <HazardReportSkeleton />,
  ssr: false,
});
const RouteExplanationPanel = dynamic(() => import("./RouteExplanationPanel"), {
  loading: () => <PanelSkeleton />,
  ssr: false,
});

function primaryDestination(
  journey: VenueJourney | null,
  route: AccessibleRoute,
  t: TFunction,
) {
  const outdoor = journey?.outdoor;
  if (!outdoor) return undefined;
  const end = route.legs.flatMap((leg) => leg.polyline ?? []).at(-1);
  if (!end || end.length < 2 || !end.every(Number.isFinite)) return undefined;
  const hasApproach = Boolean(
    route.routeToken && outdoor.approachRoutes?.[route.routeToken],
  );
  return {
    position: { lng: end[0], lat: end[1] },
    name: hasApproach
      ? venueApproachRouteKind(route) === "vehicle"
        ? t("venueDropOffPoint")
        : t("venueWalkHandoffPoint")
      : outdoor.arrival.name,
  };
}

export default function RouteContent() {
  const { t } = useAppTranslation();
  const preferences = useMapStore((s) => s.effectivePreferences);
  const invalidTokens = useMapStore((s) => s.invalidRouteTokens);
  const venueJourney = useMapStore((s) => s.venueJourney);
  const {
    computeRoutes,
    setComputeRoutes,
    setRouteSelect,
    setRouteInfoShow,
    setSheetMode,
    selectRoute,
    routeSubPanel,
    setRouteSubPanel,
  } = useMapStore(
    useShallow((s) => ({
      computeRoutes: s.computeRoutes,
      setComputeRoutes: s.setComputeRoutes,
      setRouteSelect: s.setRouteSelect,
      setRouteInfoShow: s.setRouteInfoShow,
      setSheetMode: s.setSheetMode,
      selectRoute: s.selectRoute,
      routeSubPanel: s.routeSubPanel,
      setRouteSubPanel: s.setRouteSubPanel,
    })),
  );

  // These three sub-pages belong to the route view alone. They used to ride
  // on `activeRailPanel`, which meant the home rail's selection and this
  // view's sub-page were one field — survivable only while leaving the route
  // destroyed it. A session now outlives a panel switch, so a leftover
  // "hazard" from the rail would hijack this first paint; hence its own field.
  const panel = routeSubPanel;
  const closePanel = () => setRouteSubPanel("none");

  // "返回" means "I want to change this plan", not "I'm done" — it drops the
  // results and hands the user back the form with their origin/destination
  // still in it. Ending the session outright is the X / the resume pill's ✕.
  const handleBack = () => {
    setComputeRoutes(null);
    setRouteSelect(null);
    setRouteInfoShow(false);
    setRouteSubPanel("none");
    setSheetMode("plan");
  };

  const handleStartNav = async () => {
    // iOS 13+ requires DeviceOrientation permission to be requested from a user
    // gesture — this tap is that gesture. Elsewhere no prompt is needed.
    // SAFETY: Safari's runtime permission method is absent from the standard
    // DeviceOrientationEvent type, so capability detection narrows it here.
    const DOE = (typeof DeviceOrientationEvent === "undefined"
      ? undefined
      : DeviceOrientationEvent) as unknown as
      | {
          requestPermission?: () => Promise<"granted" | "denied">;
        }
      | undefined;
    if (typeof DOE?.requestPermission === "function") {
      try {
        const res = await DOE.requestPermission();
        useNavStore
          .getState()
          .setCompassPermission(res === "granted" ? "granted" : "denied");
      } catch {
        useNavStore.getState().setCompassPermission("denied");
      }
    } else {
      useNavStore.getState().setCompassPermission("granted");
    }
    startNavigation();
  };

  if (!computeRoutes && !venueJourney) {
    return <LoadingDrawer />;
  }

  if (panel === "explanation") {
    return <RouteExplanationPanel onClose={closePanel} />;
  }
  if (panel === "environment") {
    return <EnvironmentPanel onClose={closePanel} />;
  }
  if (panel === "hazard") {
    return <HazardReportPanel onClose={closePanel} />;
  }

  const indoorOnly = Boolean(venueJourney && !venueJourney.outdoor);
  const selectedToken = selectRoute?.route.routeToken;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t("back")}
          className="relative h-8 w-8 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted transition-colors shrink-0 after:absolute after:inset-[-6px] after:content-['']"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="h-7 w-7 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0">
          <Navigation className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h1 className="text-lg font-bold">{t("routeResultsTitle")}</h1>
      </div>

      {venueJourney && (
        <p className="text-sm text-muted-foreground">
          {[
            venueJourney.to.buildingName,
            venueJourney.to.levelRef,
            venueJourney.to.name,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {preferences && (
        <p className="text-sm text-muted-foreground">
          {t("routeAppliedPreferences")}: {t(`routeMode_${preferences.mode}`)} ·{" "}
          {t(`routeTravel_${preferences.travelMode}`)} ·{" "}
          {t(`routeTransit_${preferences.transitPreference}`)}
          {preferences.avoidStairs && ` · ${t("routeAvoidStairs")}`}
          {preferences.requireElevator && ` · ${t("routeRequireElevator")}`}
          {preferences.departureTime && ` · ${preferences.departureTime}`}
        </p>
      )}
      {selectRoute?.route.routeToken &&
        invalidTokens.includes(selectRoute.route.routeToken) && (
          <p role="alert">{t("routeTokenExpired")}</p>
        )}
      {/* Start Navigation Button */}
      {(selectRoute || indoorOnly) && (
        <Button
          onClick={handleStartNav}
          disabled={
            !indoorOnly &&
            (!selectedToken || invalidTokens.includes(selectedToken))
          }
          className="w-full rounded-xl h-12 text-base gap-2"
        >
          <Navigation className="h-5 w-5" />
          {t("startNav")}
        </Button>
      )}

      {/* Quick action chips */}
      {(selectRoute || venueJourney) && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {selectRoute && (
            <button
              type="button"
              onClick={() => setRouteSubPanel("explanation")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium bg-violet-500/10 text-violet-600 dark:text-violet-400 hover:bg-violet-500/20 transition-colors whitespace-nowrap"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {t("aiExplanation")}
            </button>
          )}
          <button
            type="button"
            onClick={() => setRouteSubPanel("environment")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium bg-sky-500/10 text-sky-600 dark:text-sky-400 hover:bg-sky-500/20 transition-colors whitespace-nowrap"
          >
            <Cloud className="h-3.5 w-3.5" />
            {t("environment")}
          </button>
          <button
            type="button"
            onClick={() => setRouteSubPanel("hazard")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 transition-colors whitespace-nowrap"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {t("reportHazard")}
          </button>
        </div>
      )}

      {/* Route Cards */}
      <div className="space-y-3">
        {(computeRoutes ?? []).map((route, index) => {
          const approach = route.routeToken
            ? venueJourney?.outdoor?.approachRoutes?.[route.routeToken]
            : undefined;
          return (
            <RouteCard
              key={route.routeId || `${route.routeName}-${route.totalMinutes}`}
              idx={index}
              route={route}
              destinationDisplay={primaryDestination(venueJourney, route, t)}
              durationLabel={
                venueJourney?.outdoor ? t("routeOutdoorSection") : undefined
              }
              walkingContinuation={
                venueJourney?.outdoor
                  ? {
                      destinationName: venueJourney.to.name,
                      summary: (
                        <VenueWalkSummary
                          journey={venueJourney}
                          approach={approach}
                        />
                      ),
                      steps: (
                        <VenueWalkSteps
                          journey={venueJourney}
                          approach={approach}
                        />
                      ),
                    }
                  : undefined
              }
            />
          );
        })}
      </div>

      {venueJourney && indoorOnly && (
        <VenueRouteSteps
          journey={venueJourney}
          showArrival
          title={t("venueIndoorRouteSummary", {
            distance: Math.round(venueJourney.route.distanceM),
          })}
        />
      )}
    </div>
  );
}
