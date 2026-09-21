"use client";
import { create } from "zustand";
import { createA11ySlice } from "./map/createA11ySlice";
import { createMapInstanceSlice } from "./map/createMapInstanceSlice";
import { createRouteSlice } from "./map/createRouteSlice";
import { createSearchSlice } from "./map/createSearchSlice";
import { createSheetSlice } from "./map/createSheetSlice";
import { createTransitSlice } from "./map/createTransitSlice";
import { computeMapPadding } from "./map/mapPadding";
import type { MapStore } from "./map/types";

export type {
  MobileSheetSnap,
  RailPanel,
  RouteSubPanel,
  SavedPlaceCategory,
  SheetMode,
} from "./map/types";
export { placeKey, SAVED_PLACE_CATEGORIES } from "./map/types";

export function getMapPadding(): ReturnType<typeof computeMapPadding> {
  return computeMapPadding(useMapStore.getState().sidebarCollapsed);
}

const useMapStore = create<MapStore>((...a) => ({
  ...createMapInstanceSlice(...a),
  ...createRouteSlice(...a),
  ...createSearchSlice(...a),
  ...createTransitSlice(...a),
  ...createA11ySlice(...a),
  ...createSheetSlice(...a),
}));

export default useMapStore;
