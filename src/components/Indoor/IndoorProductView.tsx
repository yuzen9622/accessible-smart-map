"use client";

import { ArrowLeft } from "lucide-react";
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
import {
  venueJourneyPresentation,
  venueRouteSections,
} from "@/lib/indoor/journey";
import type { LocalIndoorModel, XY } from "@/lib/indoor/types";
import { cn } from "@/lib/utils";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import IndoorMapScene from "./IndoorMapScene";
import { campusRouteDisplaySegments } from "./VenueCampusRoute";

/** Keep the shown floor inside the scrolling rail without moving the page. */
function revealFloor(node: HTMLButtonElement | null) {
  const list = node?.parentElement;
  if (!node || !list) return;
  const top = node.offsetTop - list.offsetTop;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (top + node.offsetHeight > list.scrollTop + list.clientHeight)
    list.scrollTop = top + node.offsetHeight - list.clientHeight;
}

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
  const stepListOpen = useNavStore((s) => s.stepListOpen);
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
  const routeLevels = useMemo(
    () =>
      new Set(
        activeJourney
          ? venueRouteSections(activeJourney)
              .filter((section) => section.buildingId === model.building.id)
              .map((section) => section.levelRef)
          : [],
      ),
    [activeJourney, model.building.id],
  );
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
  const control =
    "pointer-events-auto bg-background/90 backdrop-blur-sm border border-border/50 shadow-lg text-foreground";
  return (
    <div
      className="absolute inset-0 z-30 pointer-events-none"
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
      {!touring && (
        <div
          className={cn(
            control,
            "absolute top-3 left-3 max-w-[calc(100%-84px)] flex items-center gap-1 rounded-full p-1",
            "lg:left-[474px]",
            collapsed && "lg:left-[88px]",
          )}
        >
          <button
            type="button"
            className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center hover:bg-muted transition-colors active:scale-[0.96]"
            aria-label={t("venueReturnCampus")}
            onClick={close}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
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
              className="h-10 min-w-0 gap-1.5 border-0 bg-transparent px-2 shadow-none text-sm font-semibold hover:bg-muted rounded-full dark:bg-transparent"
              aria-label={t("venueChooseBuilding")}
            >
              <SelectValue>
                <span className="truncate">{model.building.name}</span>
                <span className="text-muted-foreground font-medium">
                  {currentLevel.ref}
                </span>
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="z-80 max-w-[calc(100vw-24px)]">
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
        </div>
      )}
      <div
        className={cn(
          control,
          // The right edge belongs to the map buttons, so the floor rail
          // sits on the left under whatever owns the top strip.
          "absolute left-3",
          touring
            ? cn(
                "top-[calc(var(--nav-hud-h,190px)+12px)]",
                // The desktop step list opens in the same left column.
                stepListOpen && "lg:left-[404px]",
              )
            : cn("top-[72px] lg:left-[474px]", collapsed && "lg:left-[88px]"),
          "flex flex-col items-center gap-0.5 rounded-full p-1",
        )}
      >
        <button
          type="button"
          className="h-10 w-10 shrink-0 rounded-full text-[11px] font-semibold text-primary hover:bg-muted transition-colors active:scale-[0.96]"
          aria-label={view === "top" ? "切換斜視" : "切換俯視"}
          onClick={() => {
            setView(view === "top" ? "perspective" : "top");
          }}
        >
          {t(view === "top" ? "venuePerspectiveView" : "venueTopView")}
        </button>
        <div aria-hidden className="h-px w-6 shrink-0 bg-border my-0.5" />
        <nav
          aria-label={t("venueChooseFloor")}
          className={cn(
            "flex flex-col items-center gap-0.5 overflow-y-auto [scrollbar-width:none] lg:max-h-[60dvh]",
            touring
              ? "max-h-[calc(100dvh-var(--nav-hud-h,190px)-var(--bottom-sheet-h,0px)-150px)]"
              : "max-h-[calc(100dvh-var(--bottom-sheet-h,12dvh)-150px)]",
          )}
        >
          {[...levels].reverse().map((level) => {
            const active = level.ref === currentLevel.ref;
            return (
              <button
                type="button"
                key={level.ref}
                aria-label={t("venueShowFloor", { floor: level.ref })}
                aria-pressed={active}
                ref={active ? revealFloor : undefined}
                onClick={() => {
                  useIndoorCatalog.getState().setActiveLevel(level.ordinal);
                }}
                className={cn(
                  "relative h-10 w-10 shrink-0 rounded-full text-xs font-bold tabular-nums transition-colors active:scale-[0.96]",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-foreground hover:bg-muted",
                )}
              >
                {level.ref}
                {routeLevels.has(level.ref) && (
                  <span
                    aria-hidden
                    className={cn(
                      "absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full",
                      active ? "bg-primary-foreground" : "bg-primary",
                    )}
                  />
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
