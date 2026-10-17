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
  userLocationFix: null,
  setUserLocation: (userLocation, fix) => {
    const userLocationFix =
      userLocation &&
      fix &&
      Number.isFinite(fix.accuracyM) &&
      fix.accuracyM >= 0 &&
      Number.isFinite(fix.timestamp)
        ? { accuracyM: fix.accuracyM, timestamp: fix.timestamp }
        : null;
    // Preserve coordinate identity for stationary fixes, while fresh accuracy
    // and timestamps still notify proximity consumers. Unverified/cache writes
    // clear the prior fix rather than inheriting GPS credibility.
    const prev = get().userLocation;
    const sameCoordinates =
      prev &&
      userLocation &&
      (userLocationFix
        ? prev.lat === userLocation.lat && prev.lng === userLocation.lng
        : Math.abs(prev.lat - userLocation.lat) < 5e-6 &&
          Math.abs(prev.lng - userLocation.lng) < 5e-6);
    if (sameCoordinates) {
      const priorFix = get().userLocationFix;
      if (
        priorFix?.accuracyM !== userLocationFix?.accuracyM ||
        priorFix?.timestamp !== userLocationFix?.timestamp
      )
        set({ userLocationFix });
      return;
    }
    set({ userLocation, userLocationFix });
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
    const venueStatus = get().venueJourney?.guidance.status;
    const manualVenue = venueStatus === "guiding" || venueStatus === "arrived";
    if (map && (!isNavigating || manualVenue)) {
      if (v) map.easeTo({ pitch: 60, duration: 600 });
      else map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    }
  },
  sidebarCollapsed: false,
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
});
