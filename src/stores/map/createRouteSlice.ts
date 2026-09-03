"use client";
import type { MapSliceCreator, MapStore, RouteSlice } from "./types";

export const createRouteSlice: MapSliceCreator<RouteSlice> = (set, get) => ({
  origin: null,
  setOrigin: (origin) => set({ origin }),
  destination: null,
  setDestination: (destination) => set({ destination }),
  originName: "",
  setOriginName: (name) => set({ originName: name }),
  destinationName: "",
  setDestinationName: (name) => set({ destinationName: name }),
  computeRoutes: null,
  setComputeRoutes: (routes) =>
    set(
      routes
        ? { computeRoutes: routes }
        : {
            computeRoutes: null,
            metroAlerts: null,
            transitAlerts: null,
            routeWaypoints: [],
          },
    ),
  selectRoute: null,
  setRouteSelect: (route) => {
    if (!route) {
      set({ selectRoute: null, activeBusLeg: null, liveBusPositions: [] });
      return;
    }
    const prev = get().selectRoute;
    const next = {
      selectRoute: {
        ...prev,
        ...route,
      } as MapStore["selectRoute"],
    };
    if (prev?.index === route.index) {
      set(next);
      return;
    }
    set({ ...next, activeBusLeg: null, liveBusPositions: [] });
  },
  routeWaypoints: [],
  setRouteWaypoints: (waypoints) => set({ routeWaypoints: waypoints }),
  routeInfoShow: false,
  setRouteInfoShow: (show) => set({ routeInfoShow: show }),
  metroAlerts: null,
  setMetroAlerts: (alerts) => set({ metroAlerts: alerts }),
  transitAlerts: null,
  setTransitAlerts: (alerts) => set({ transitAlerts: alerts }),
  sosNavActive: false,
  setSosNavActive: (active) => set({ sosNavActive: active }),
});
