import type { IndoorSceneRouteSegment } from "./campusRouteSegments";
import type { IndoorTheme } from "./indoorTheme";
import type { IndoorRoute, LocalIndoorModel } from "./types";

export interface IndoorBuildingView {
  key: string;
  model: LocalIndoorModel;
  /** No source floor selected: keep this building's cutaway empty. */
  levelOrdinal: number | null;
}

export interface IndoorSceneProps {
  /** Legacy diagnostic scenes remain light unless explicitly themed. */
  theme?: IndoorTheme;
  model: LocalIndoorModel;
  buildingViews?: IndoorBuildingView[];
  activeBuildingKey?: string;
  onSelectBuildingFeature?: (target: {
    buildingKey: string;
    featureId: string;
  }) => void;
  /** Planar route presentation only; never changes physical animation safety. */
  routeTour?: boolean;
  routePlaying?: boolean;
  /** Authored cross-building/outdoor segments in model.origin's metre frame. */
  campusRouteSegments?: IndoorSceneRouteSegment[];
  visibleLevels: number[];
  view: "top" | "perspective";
  selectedId: string | null;
  onSelect: (id: string) => void;
  route: IndoorRoute | null;
  progress: number;
  /** Absolute route progress is unchanged when travel direction reverses. */
  routeDirection?: 1 | -1;
  /** Map cutaway: show source facility areas/icons and project guidance onto
   * the displayed floor. The host places this slice at ground level; source
   * elevations and the separate physical-geometry diagnostic stay unchanged. */
  grounded?: boolean;
  exploded: boolean;
  focusId: string | null;
  cameraAction: {
    type: "zoomIn" | "zoomOut" | "rotate" | "reset";
    nonce: number;
  };
  showLabels: boolean;
  stairPreview?: { widthM: number; risers: number[] };
  onGeometryStatus?: (status: { collisionCount: number }) => void;
  /** Leave the cutaway when the map returns to the surrounding-building scale. */
  onOverviewExit?: () => void;
}
