"use client";

import { LngLatBounds } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { localToLngLat } from "@/lib/indoor/coordinates";
import { venueJourneyPresentation } from "@/lib/indoor/journey";
import { sampleRoutePresentation } from "@/lib/indoor/routePresentation";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore, { getMapPadding } from "@/stores/useMapStore";

/** Navigation progress controls the cutaway; browsing never confirms arrival. */
export default function VenueJourneyMapSync() {
  const journey = useMapStore((s) => s.venueJourney);
  const models = useIndoorCatalog((s) => s.models);
  const last = useRef<{ id: string; level: string | null } | null>(null);
  const previewedRoute = useRef<string | null>(null);
  const map = useMapStore((s) => s.map);
  useEffect(() => {
    const outdoor = journey?.outdoor;
    if (!map || !outdoor || journey.guidance.status !== "idle") {
      previewedRoute.current = null;
      return;
    }
    const route = outdoor.routes[outdoor.selectedIndex];
    if (!route) return;
    const key = `${journey.id}/${route.routeToken ?? route.routeId}`;
    if (previewedRoute.current === key) return;
    previewedRoute.current = key;
    const approach = route.routeToken
      ? outdoor.approachRoutes?.[route.routeToken]
      : undefined;
    const bounds = new LngLatBounds();
    bounds.extend([outdoor.origin.position.lng, outdoor.origin.position.lat]);
    bounds.extend([journey.to.position.lng, journey.to.position.lat]);
    for (const part of [route, approach])
      for (const leg of part?.legs ?? [])
        for (const point of leg.polyline) bounds.extend(point);
    useMapStore.getState().setIndoorExploring(false);
    map.fitBounds(bounds, {
      padding: getMapPadding(),
      maxZoom: 17,
      duration: 800,
    });
  }, [journey, map]);

  useEffect(() => {
    if (!journey || !["guiding", "arrived"].includes(journey.guidance.status)) {
      last.current = null;
      return;
    }
    const model = models.find(
      (item) =>
        item.venueId === journey.venueId &&
        item.building.id === journey.buildingId &&
        item.source.sha256 === journey.sourceVersion,
    );
    if (!model) return;
    const position = venueJourneyPresentation(journey);
    const presentation = sampleRoutePresentation(
      model,
      journey.route,
      position.progress,
      position.direction,
    );
    const previous = last.current;
    const level = presentation.currentLevelRef;
    last.current = { id: journey.id, level };
    if (previous?.id === journey.id && previous.level === level) return;
    const state = useMapStore.getState();
    const floor = model.building.levels.find((item) => item.ref === level);
    if (floor) {
      if (!state.indoorExploring)
        useIndoorCatalog.getState().showBuilding(model);
      useIndoorCatalog.getState().setActiveLevel(floor.ordinal);
    } else {
      state.setIndoorExploring(false);
      const bounds = new LngLatBounds();
      for (const step of journey.route.steps) {
        if (step.fromLevel !== null && step.toLevel !== null) continue;
        for (const point of journey.route.points.slice(
          step.startIndex,
          step.endIndex + 1,
        ))
          bounds.extend(localToLngLat([point[0], point[1]], model.origin));
      }
      if (!bounds.isEmpty())
        state.map?.fitBounds(bounds, {
          padding: getMapPadding(),
          maxZoom: 19,
          duration: 900,
        });
    }
  }, [journey, models]);
  return null;
}
