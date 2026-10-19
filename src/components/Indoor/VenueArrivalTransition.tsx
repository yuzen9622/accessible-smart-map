"use client";

import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import type { VenueArrivalCandidate } from "@/lib/indoor/arrivalTransition";
import { tryAutoConfirmVenueArrival } from "@/lib/navigation/navigationLifecycle";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";

/** Observes the existing journey and navigation engine; owns no route state. */
export default function VenueArrivalTransition() {
  const mapInputs = useMapStore(
    useShallow((state) => ({
      journey: state.venueJourney,
      isNavigating: state.isNavigating,
      location: state.userLocation,
      fix: state.userLocationFix,
      generation: state.routeGeneration,
      activeRoute: state.activeNavigationRoute,
      invalidTokens: state.invalidRouteTokens,
    })),
  );
  const navInputs = useNavStore(
    useShallow((state) => ({
      instructions: state.instructions,
      index: state.currentStepIndex,
      mode: state.navigationMode,
      ride: state.transitRide,
      guide: state.transitGuide,
      navigationId: state.navigationId,
      version: state.routeVersion,
      source: state.navigationSource,
    })),
  );
  const models = useIndoorCatalog((state) => state.models);
  const candidate = useRef<VenueArrivalCandidate | null>(null);
  useEffect(() => {
    // These subscriptions invalidate a prior candidate even without a new fix.
    void mapInputs;
    void navInputs;
    void models;
    candidate.current = tryAutoConfirmVenueArrival(candidate.current).candidate;
  }, [mapInputs, navInputs, models]);
  return null;
}
