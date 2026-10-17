"use client";

import { ArrowLeft, Layers, LocateFixed } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { placeForVenueFeature, toVenuePlaceDetail } from "@/lib/indoor/catalog";
import { localToLngLat } from "@/lib/indoor/coordinates";
import { centroid } from "@/lib/indoor/geometry";
import { venueJourneyPresentation } from "@/lib/indoor/journey";
import { sampleRoutePresentation } from "@/lib/indoor/routePresentation";
import type { LocalIndoorModel, XY } from "@/lib/indoor/types";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";
import IndoorMapScene from "./IndoorMapScene";
import styles from "./product-map.module.css";

export default function IndoorProductView({
  model,
  onClose,
}: {
  model: LocalIndoorModel;
  onClose: () => void;
}) {
  const activeLevel = useIndoorCatalog((s) => s.activeLevel);
  const selectedId = useIndoorCatalog((s) => s.selectedFeatureId);
  const focusVersion = useIndoorCatalog((s) => s.focusVersion);
  const collapsed = useMapStore((s) => s.sidebarCollapsed);
  const journey = useMapStore((s) => s.venueJourney);
  const [view, setView] = useState<"top" | "perspective">("perspective");
  const [following, setFollowing] = useState(true);
  const [cameraAction, setCameraAction] = useState({
    type: "reset" as const,
    nonce: 0,
  });
  const previousFocus = useRef(focusVersion);
  const activeJourney =
    journey?.venueId === model.venueId &&
    journey.buildingId === model.building.id &&
    journey.sourceVersion === model.source.sha256
      ? journey
      : null;
  const position = activeJourney
    ? venueJourneyPresentation(activeJourney)
    : { progress: 0, direction: 1 as const };
  const route = activeJourney?.route;
  const presentation = useMemo(
    () =>
      route
        ? sampleRoutePresentation(
            model,
            route,
            position.progress,
            position.direction,
          )
        : null,
    [model, route, position.progress, position.direction],
  );
  const guidanceLevel = model.building.levels.find(
    (item) => item.ref === presentation?.currentLevelRef,
  );
  const currentLevel =
    model.building.levels.find((item) => item.ordinal === activeLevel) ??
    model.building.levels[0];
  const routeId = activeJourney?.id;
  const stepIndex = activeJourney?.guidance.stepIndex;
  const guidanceStatus = activeJourney?.guidance.status;
  // A newly confirmed step resumes following; viewing another floor alone does not.
  const followStep = `${routeId}/${stepIndex}/${guidanceStatus}`;
  const previousStep = useRef(followStep);
  useEffect(() => {
    if (previousStep.current !== followStep) {
      previousStep.current = followStep;
      setFollowing(true);
    }
  }, [followStep]);
  useEffect(() => {
    if (following && guidanceLevel)
      useIndoorCatalog.getState().setActiveLevel(guidanceLevel.ordinal);
  }, [following, guidanceLevel]);
  const shouldFollowFocus = Boolean(
    activeJourney?.preview.playing || guidanceStatus === "guiding",
  );
  useEffect(() => {
    if (previousFocus.current === focusVersion) return;
    previousFocus.current = focusVersion;
    setFollowing(shouldFollowFocus);
    setCameraAction((old) => ({ type: "reset", nonce: old.nonce + 1 }));
  }, [focusVersion, shouldFollowFocus]);
  const onSelect = useCallback(
    (id: string) => {
      const state = useMapStore.getState();
      // Guidance remains visible; tapping a feature must not replace its live step UI.
      if (state.isNavigating) return;
      const feature = model.features.find((item) => item.id === id);
      const connection = model.connections.find((item) => item.id === id);
      const place = feature
        ? placeForVenueFeature(model, feature)
        : model.places.find(
            (item) =>
              item.levelRef === currentLevel.ref &&
              (item.connectionId === id || item.connectionIds?.includes(id)),
          );
      if (!feature && !connection) return;
      useIndoorCatalog.getState().setSelectedFeatureId(feature?.id ?? id);
      setFollowing(false);
      if (state.venueJourney?.preview.playing)
        state.setVenueJourneyPreview({ playing: false });
      if (place) {
        const detail = toVenuePlaceDetail(model, place);
        state.setSearchPlace(detail);
        state.setInfoShow({ ...detail, isOpen: true });
      } else {
        const point: XY =
          feature?.geometry.type === "Polygon"
            ? centroid(feature.geometry.coordinates[0])
            : feature?.geometry.type === "Point"
              ? feature.geometry.coordinates
              : ((connection?.coordinates[0]?.slice(0, 2) as XY) ?? [0, 0]);
        const [lng, lat] = localToLngLat(point, model.origin);
        const name = feature?.name ?? connection?.name ?? "室內空間";
        state.setSearchPlace(null);
        state.setInfoShow({
          kind: "venue-feature",
          featureId: id,
          venueId: model.venueId,
          buildingId: model.building.id,
          name,
          address: `${model.building.name} · ${currentLevel.ref} · ${name}`,
          levelRef: currentLevel.ref,
          position: { lat, lng },
          isOpen: true,
        });
      }
      state.setSheetMode("place");
      state.setMobileSheetSnap("half");
    },
    [model, currentLevel.ref],
  );
  return (
    <div
      className={styles.host}
      data-collapsed={collapsed}
      data-testid="indoor-product-view"
    >
      <IndoorMapScene
        model={model}
        visibleLevels={[currentLevel.ordinal]}
        view={view}
        selectedId={selectedId}
        focusId={selectedId}
        onSelect={onSelect}
        route={activeJourney?.route ?? null}
        progress={position.progress}
        routeDirection={position.direction}
        grounded
        exploded={false}
        cameraAction={cameraAction}
        showLabels
        onOverviewExit={onClose}
      />
      <div className={styles.buildingBar}>
        <button type="button" aria-label="返回校園地圖" onClick={onClose}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <strong>{model.building.name}</strong>
          <span>{currentLevel.ref} · 室內地圖</span>
        </div>
        <button
          type="button"
          aria-label={view === "top" ? "切換斜視" : "切換俯視"}
          onClick={() => setView(view === "top" ? "perspective" : "top")}
        >
          {view === "top" ? "斜視" : "俯視"}
        </button>
      </div>
      <nav className={styles.floors} aria-label="選擇顯示樓層">
        <Layers size={16} aria-hidden="true" />
        {[...model.building.levels].reverse().map((level) => (
          <button
            type="button"
            key={level.ref}
            aria-label={`顯示 ${level.ref}`}
            aria-pressed={level.ordinal === currentLevel.ordinal}
            onClick={() => {
              setFollowing(false);
              useMapStore.getState().setVenueJourneyPreview({ playing: false });
              useIndoorCatalog.getState().setActiveLevel(level.ordinal);
            }}
          >
            {level.ref}
          </button>
        ))}
      </nav>
      {activeJourney &&
        !following &&
        guidanceLevel &&
        guidanceLevel.ordinal !== currentLevel.ordinal && (
          <button
            type="button"
            className={styles.resume}
            onClick={() => setFollowing(true)}
          >
            <LocateFixed size={16} />
            回到{guidanceStatus === "guiding" ? "導引" : "路線"}樓層{" "}
            {guidanceLevel.ref}
          </button>
        )}
    </div>
  );
}
