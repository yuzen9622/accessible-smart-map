"use client";
import type { InfoShow } from "@/types";
import type { MapInstanceSlice, MapSliceCreator, MapStore } from "./types";

export const createMapInstanceSlice: MapSliceCreator<MapInstanceSlice> = (
  set,
  get,
) => ({
  map: null,
  setMap: (map) => set({ map }),
  userLocation: null,
  setUserLocation: (userLocation) => {
    // GPS fires ~every second even when standing still; skip writes when the
    // fix moved less than ~0.5 m so subscribers don't re-render for nothing.
    const prev = get().userLocation;
    if (
      prev &&
      userLocation &&
      Math.abs(prev.lat - userLocation.lat) < 5e-6 &&
      Math.abs(prev.lng - userLocation.lng) < 5e-6
    ) {
      return;
    }
    set({ userLocation });
  },
  infoShow: { isOpen: false, kind: null },
  setInfoShow: (infoShow) => {
    const nextInfoShow = {
      ...get().infoShow,
      // A new selection must not inherit the previous facility's identity.
      // Pure visibility patches keep it; explicit facility selections supply it.
      ...(infoShow.kind === undefined
        ? {}
        : { facilityId: undefined, canonicalAddress: undefined }),
      ...infoShow,
    } as InfoShow;
    const update: Partial<MapStore> = { infoShow: nextInfoShow };
    if (nextInfoShow.isOpen) {
      update.sidebarCollapsed = false;
    }
    set(update);
  },
  is3D: false,
  setIs3D: (v) => {
    set({ is3D: v });
    const { map, isNavigating } = get();
    // While navigating the camera loop applies pitch/bearing every tick;
    // easing here would fight it, so only drive the camera outside navigation.
    // 2D means a flat, north-up plane — reset bearing along with pitch.
    if (map && !isNavigating) {
      if (v) map.easeTo({ pitch: 60, duration: 600 });
      else map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    }
  },
  sidebarCollapsed: false,
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
});
