"use client";

import { ArrowLeft, Layers } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppTranslation } from "@/i18n/client";
import {
  campusBuildingViews,
  campusModels,
  defaultIndoorLevel,
} from "@/lib/indoor/campusDisplay";
import {
  indoorModelVersion,
  placeForVenueFeature,
  toVenuePlaceDetail,
  venueBuildingKey,
} from "@/lib/indoor/catalog";
import { localToLngLat } from "@/lib/indoor/coordinates";
import { indoorFeatureName } from "@/lib/indoor/facilityAreas";
import { centroid } from "@/lib/indoor/geometry";
import { venueJourneyPresentation } from "@/lib/indoor/journey";
import type { LocalIndoorModel, XY } from "@/lib/indoor/types";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";
import IndoorMapScene from "./IndoorMapScene";
import styles from "./product-map.module.css";
import { campusRouteDisplaySegments } from "./VenueCampusRoute";

export default function IndoorProductView({
  model,
  onClose,
}: {
  model: LocalIndoorModel;
  onClose: () => void;
}) {
  const { t } = useAppTranslation();
  const activeLevel = useIndoorCatalog((s) => s.activeLevel);
  const models = useIndoorCatalog((s) => s.models);
  const selectedId = useIndoorCatalog((s) => s.selectedFeatureId);
  const focusVersion = useIndoorCatalog((s) => s.focusVersion);
  const collapsed = useMapStore((s) => s.sidebarCollapsed);
  const journey = useMapStore((s) => s.venueJourney);
  const [view, setView] = useState<"top" | "perspective">("perspective");
  const [cameraAction, setCameraAction] = useState({
    type: "reset" as const,
    nonce: 0,
  });
  const previousFocus = useRef(focusVersion);
  const activeJourney =
    journey?.venueId === model.venueId &&
    (journey.buildingId === model.building.id || journey.route.context) &&
    journey.sourceVersion === indoorModelVersion(model)
      ? journey
      : null;
  const position = activeJourney
    ? venueJourneyPresentation(activeJourney)
    : { progress: 0, direction: 1 as const };
  const route = activeJourney?.route;
  const touring = activeJourney?.guidance.status === "touring";
  const venueModels = useMemo(
    () => campusModels(models, model),
    [models, model],
  );
  const levels = useMemo(
    () => [...model.building.levels].sort((a, b) => a.ordinal - b.ordinal),
    [model],
  );
  const currentLevel =
    levels.find((level) => level.ordinal === activeLevel) ??
    defaultIndoorLevel(model);
  const proposedViews = useMemo(
    () => campusBuildingViews(venueModels, currentLevel.ref),
    [venueModels, currentLevel.ref],
  );
  const stableViews = useRef(proposedViews);
  if (
    stableViews.current.length !== proposedViews.length ||
    proposedViews.some(
      (view, index) =>
        stableViews.current[index].model !== view.model ||
        stableViews.current[index].levelOrdinal !== view.levelOrdinal ||
        stableViews.current[index].levelRef !== view.levelRef,
    )
  )
    stableViews.current = proposedViews;
  const buildingViews = stableViews.current;
  const campusSegments = useMemo(
    () =>
      route
        ? campusRouteDisplaySegments(
            route,
            model,
            buildingViews.flatMap((item) =>
              item.levelRef
                ? [
                    {
                      buildingId: item.model.building.id,
                      levelRef: item.levelRef,
                      groundElevationM:
                        item.levelOrdinal === 0
                          ? item.model.building.levels.find(
                              (level) => level.ordinal === 0,
                            )?.elevationM
                          : undefined,
                    },
                  ]
                : [],
            ),
          )
        : [],
    [route, buildingViews, model],
  );
  useEffect(() => {
    if (previousFocus.current === focusVersion) return;
    previousFocus.current = focusVersion;
    setCameraAction((old) => ({ type: "reset", nonce: old.nonce + 1 }));
  }, [focusVersion]);
  const onSelect = useCallback(
    ({
      buildingKey,
      featureId: id,
    }: {
      buildingKey: string;
      featureId: string;
    }) => {
      const state = useMapStore.getState();
      // Keep route controls in the original navigation sheet.
      if (state.isNavigating) return;
      const selected = buildingViews.find((item) => item.key === buildingKey);
      if (!selected || selected.levelOrdinal === null) return;
      const selectedModel = selected.model;
      const level = selectedModel.building.levels.find(
        (item) => item.ordinal === selected.levelOrdinal,
      );
      if (!level) return;
      const feature = selectedModel.features.find((item) => item.id === id);
      const connection = selectedModel.connections.find(
        (item) => item.id === id,
      );
      const place = feature
        ? placeForVenueFeature(selectedModel, feature)
        : selectedModel.places.find(
            (item) =>
              item.levelRef === level.ref &&
              (item.connectionId === id || item.connectionIds?.includes(id)),
          );
      if (!feature && !connection) return;
      const catalog = useIndoorCatalog.getState();
      catalog.setActiveBuilding(selectedModel);
      catalog.setSelectedFeatureId(feature?.id ?? id);
      if (place) {
        const detail = toVenuePlaceDetail(selectedModel, place);
        state.setSearchPlace(detail);
        state.setInfoShow({ ...detail, isOpen: true });
      } else {
        const point: XY =
          feature?.geometry.type === "Polygon"
            ? centroid(feature.geometry.coordinates[0])
            : feature?.geometry.type === "Point"
              ? feature.geometry.coordinates
              : ((connection?.coordinates[0]?.slice(0, 2) as XY) ?? [0, 0]);
        const [lng, lat] = localToLngLat(point, selectedModel.origin);
        const name =
          (feature ? indoorFeatureName(feature) : undefined) ??
          connection?.name ??
          t("venueIndoorMap");
        state.setSearchPlace(null);
        state.setInfoShow({
          kind: "venue-feature",
          featureId: id,
          venueId: selectedModel.venueId,
          buildingId: selectedModel.building.id,
          name,
          address: `${selectedModel.building.name} · ${level.ref} · ${name}`,
          levelRef: level.ref,
          position: { lat, lng },
          isOpen: true,
        });
      }
      state.setSheetMode("place");
      state.setMobileSheetSnap("half");
    },
    [buildingViews, t],
  );
  const currentBuildingView = buildingViews.find(
    (item) => item.key === venueBuildingKey(model),
  );
  const close = () => {
    onClose();
  };
  return (
    <div
      className={styles.host}
      data-collapsed={collapsed}
      data-testid="indoor-product-view"
    >
      <IndoorMapScene
        model={model}
        buildingViews={buildingViews}
        activeBuildingKey={venueBuildingKey(model)}
        visibleLevels={
          currentBuildingView?.levelOrdinal == null
            ? []
            : [currentBuildingView.levelOrdinal]
        }
        view={view}
        selectedId={selectedId}
        focusId={selectedId}
        onSelect={(featureId) =>
          onSelect({ buildingKey: venueBuildingKey(model), featureId })
        }
        onSelectBuildingFeature={onSelect}
        route={activeJourney?.route ?? null}
        campusRouteSegments={campusSegments}
        progress={position.progress}
        routeDirection={position.direction}
        routeTour={touring}
        routePlaying={activeJourney?.preview.playing ?? false}
        grounded
        exploded={false}
        cameraAction={cameraAction}
        showLabels
        onOverviewExit={close}
      />
      <div className={styles.buildingBar}>
        <button
          type="button"
          className={styles.barAction}
          aria-label={t("venueReturnCampus")}
          onClick={close}
        >
          <ArrowLeft size={18} />
        </button>
        <div className={styles.buildingDetails}>
          <Select
            value={venueBuildingKey(model)}
            onValueChange={(value) => {
              const chosen = venueModels.find(
                (item) => venueBuildingKey(item) === value,
              );
              if (chosen) {
                useIndoorCatalog.getState().showBuilding(chosen);
              }
            }}
          >
            <SelectTrigger
              className={styles.buildingSelect}
              aria-label={t("venueChooseBuilding")}
            >
              <SelectValue>{model.building.name}</SelectValue>
            </SelectTrigger>
            <SelectContent className={styles.buildingOptions}>
              {venueModels.map((item) => (
                <SelectItem
                  key={venueBuildingKey(item)}
                  value={venueBuildingKey(item)}
                >
                  {item.building.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className={styles.buildingSubtitle}>
            {currentLevel.ref} ·{" "}
            {t(
              currentBuildingView?.levelOrdinal == null
                ? "venueFloorGeometryUnavailable"
                : "venueCampusIndoorMap",
            )}
          </span>
        </div>
        <button
          type="button"
          className={styles.barAction}
          aria-label={view === "top" ? "切換斜視" : "切換俯視"}
          onClick={() => {
            setView(view === "top" ? "perspective" : "top");
          }}
        >
          {t(view === "top" ? "venuePerspectiveView" : "venueTopView")}
        </button>
      </div>
      <nav className={styles.floors} aria-label={t("venueChooseFloor")}>
        <Layers size={16} aria-hidden="true" />
        {[...levels].reverse().map((level) => (
          <button
            type="button"
            key={level.ref}
            aria-label={t("venueShowFloor", { floor: level.ref })}
            aria-pressed={level.ref === currentLevel.ref}
            onClick={() => {
              useIndoorCatalog.getState().setActiveLevel(level.ordinal);
            }}
          >
            {level.ref}
          </button>
        ))}
      </nav>
    </div>
  );
}
