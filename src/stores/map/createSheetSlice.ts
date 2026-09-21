"use client";
import { LngLatBounds } from "maplibre-gl";
import { routeResumeTarget } from "@/lib/route/routeSession";
import { computeMapPadding } from "./mapPadding";
import type {
  MapSliceCreator,
  MapStore,
  MobileSheetSnap,
  RailPanel,
  RouteSubPanel,
  SheetSlice,
} from "./types";

export const createSheetSlice: MapSliceCreator<SheetSlice> = (set, get) => ({
  sheetMode: "home",
  setSheetMode: (mode) => {
    const update: Partial<MapStore> = { sheetMode: mode };
    if (mode !== "home" && mode !== "navigation") {
      update.sidebarCollapsed = false;
    }
    if (get().chatOpen) {
      update.chatOpen = false;
    }
    set(update);
  },
  mobileSheetSnap: "peek" as MobileSheetSnap,
  setMobileSheetSnap: (snap) => set({ mobileSheetSnap: snap }),
  isNavigating: false,
  setIsNavigating: (v) => {
    const { map } = get();
    if (v) {
      set({ isNavigating: true, sheetMode: "navigation", is3D: true });
    } else {
      // routeSubPanel is its own field now, so returning from navigation lands
      // on the route list without having to overwrite whatever the rail was
      // showing. (It used to reset activeRailPanel to "route" for exactly this
      // reason, back when the two shared one field.)
      set({
        isNavigating: false,
        sheetMode: "route",
        routeSubPanel: "none",
        is3D: false,
      });
      if (map) {
        const legs = get().selectRoute?.route.legs ?? [];
        const bounds = new LngLatBounds();
        for (const leg of legs) {
          for (const [lng, lat] of leg.polyline ?? [])
            bounds.extend([lng, lat]);
        }
        if (bounds.isEmpty()) {
          map.easeTo({ pitch: 0, bearing: 0, duration: 1000 });
        } else {
          map.fitBounds(bounds, {
            pitch: 0,
            bearing: 0,
            duration: 1000,
            padding: computeMapPadding(get().sidebarCollapsed),
          });
        }
      }
    }
  },
  pendingNavExit: null,
  requestNavExit: (target) => {
    if (!get().isNavigating) {
      return;
    }
    set({ pendingNavExit: { target } });
  },
  confirmNavExit: () => {
    const intent = get().pendingNavExit;
    set({ pendingNavExit: null });
    if (!intent) return;
    // End navigation first — setIsNavigating(false) sets sheetMode to "route",
    // but the intent callback below will override it to the desired target.
    set({ isNavigating: false, is3D: false });
    const { map } = get();
    if (map) {
      const legs = get().selectRoute?.route.legs ?? [];
      const bounds = new LngLatBounds();
      for (const leg of legs) {
        for (const [lng, lat] of leg.polyline ?? []) bounds.extend([lng, lat]);
      }
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, {
          pitch: 0,
          bearing: 0,
          duration: 1000,
          padding: computeMapPadding(get().sidebarCollapsed),
        });
      } else {
        map.easeTo({ pitch: 0, bearing: 0, duration: 1000 });
      }
    }
    // Apply the intent: switch to the target panel
    if (intent.target === "plan") {
      get().setSheetMode("plan");
      return;
    }
    get().setSheetMode("home");
    // Leaving navigation for somewhere outside the route flow is an explicit
    // "I'm done with this route" — the one panel switch that still ends the
    // session, because the user confirmed it in ExitNavDialog.
    get().endRouteSession();
    set({ infoShow: { isOpen: false, kind: null }, searchPlace: null });
    if (intent.target !== "home") {
      get().setActiveRailPanel(intent.target);
    }
  },
  cancelNavExit: () => {
    set({ pendingNavExit: null });
  },
  activeRailPanel: "search" as RailPanel,
  setActiveRailPanel: (panel) => {
    const update: Partial<MapStore> = { activeRailPanel: panel };
    if (panel !== "none") {
      update.sidebarCollapsed = false;
    }
    if (get().chatOpen) {
      update.chatOpen = false;
    }
    set(update);
  },
  routeSubPanel: "none" as RouteSubPanel,
  setRouteSubPanel: (panel) => set({ routeSubPanel: panel }),
  resumeRouteSession: () => {
    const target = routeResumeTarget(get().computeRoutes);
    set({ routeSubPanel: "none" });
    get().setSheetMode(target);
  },
});
