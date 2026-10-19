"use client";

import { LngLatBounds } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { indoorModelVersion, venueBuildingKey } from "@/lib/indoor/catalog";
import { venueJourneyPresentation } from "@/lib/indoor/journey";
import { sampleRoutePresentation } from "@/lib/indoor/routePresentation";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore, { getMapPadding } from "@/stores/useMapStore";

/** Open the route start once. Animated arrows never own the map camera or
 * advance a floor, a location fix, or arrival state. */
export default function VenueJourneyMapSync() {
  const journey = useMapStore((s) => s.venueJourney);
  const models = useIndoorCatalog((s) => s.models);
  const map = useMapStore((s) => s.map);
  const openedJourney = useRef<string | null>(null);
  const last = useRef<{
    id: string;
    building: string | null;
    level: string | null;
    step: number | null;
  } | null>(null);
  const previewedRoute = useRef<string | null>(null);
  const previewWasPlaying = useRef(false);
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
    if (journey?.guidance.status !== "touring") {
      openedJourney.current = null;
      return;
    }
    if (openedJourney.current === journey.id) return;
    const model = models.find(
      (item) =>
        item.venueId === journey.venueId &&
        item.building.id === journey.buildingId &&
        indoorModelVersion(item) === journey.sourceVersion,
    );
    if (!model) return;
    const start = sampleRoutePresentation(model, journey.route, 0, 1);
    const currentModel =
      models.find(
        (item) =>
          item.venueId === journey.venueId &&
          indoorModelVersion(item) === journey.sourceVersion &&
          item.building.id === start.currentBuildingId,
      ) ?? model;
    const floor = currentModel.building.levels.find(
      (item) => item.ref === start.currentLevelRef,
    );
    openedJourney.current = journey.id;
    const catalog = useIndoorCatalog.getState();
    catalog.showBuilding(currentModel);
    if (floor) catalog.setActiveLevel(floor.ordinal);
  }, [journey, models]);

  // Retain explicit step confirmation and the separate diagnostic preview.
  // Product route animation has no moving cursor and never enters this branch.
  useEffect(() => {
    if (journey?.guidance.status === "touring") {
      last.current = null;
      previewWasPlaying.current = false;
      return;
    }
    const finishedPreview =
      previewWasPlaying.current &&
      (journey?.preview.progress === 0 || journey?.preview.progress === 1);
    previewWasPlaying.current = journey?.preview.playing ?? false;
    if (
      !journey ||
      (!journey.preview.playing &&
        !finishedPreview &&
        !["guiding", "arrived"].includes(journey.guidance.status))
    ) {
      last.current = null;
      return;
    }
    const model = models.find(
      (item) =>
        item.venueId === journey.venueId &&
        item.building.id === journey.buildingId &&
        indoorModelVersion(item) === journey.sourceVersion,
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
    const level = presentation.currentLevelRef,
      building = presentation.currentBuildingId;
    const step =
      journey.guidance.status === "guiding" ? journey.guidance.stepIndex : null;
    const changed =
      previous?.id !== journey.id ||
      previous.building !== building ||
      previous.level !== level ||
      previous.step !== step;
    last.current = { id: journey.id, building, level, step };
    if (!changed) return;
    const state = useMapStore.getState();
    const catalog = useIndoorCatalog.getState();
    const currentModel = models.find(
      (item) =>
        item.venueId === journey.venueId &&
        indoorModelVersion(item) === journey.sourceVersion &&
        item.building.id === building,
    );
    const floor = currentModel?.building.levels.find(
      (item) => item.ref === level,
    );
    // Authored outdoor links leave the campus cutaway open.
    if (currentModel && floor) {
      if (
        !state.indoorExploring ||
        catalog.activeBuildingKey !== venueBuildingKey(currentModel)
      )
        catalog.showBuilding(currentModel);
      catalog.setActiveLevel(floor.ordinal);
    }
  }, [journey, models]);
  return null;
}
