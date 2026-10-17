import type { IndoorRoute, LocalIndoorModel } from "./types";

export interface IndoorSceneProps {
  model: LocalIndoorModel;
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
