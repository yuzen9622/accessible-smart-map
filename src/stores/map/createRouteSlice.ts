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
  // Every field below is something that puts route geometry on the map or
  // feeds the panel that describes it. Listing them in one place is the whole
  // point: the four hand-copied clear lists this replaces each covered a
  // different subset, and all four missed origin/destination — which is why
  // the destination pin survived every panel switch.
  //
  // Deliberately *not* here: `searchPlace` / `infoShow`. Those belong to the
  // place-detail surface, and the pill's ✕ can be pressed while the user is
  // reading an unrelated place — pulling that out from under them would blank
  // the panel they're actually looking at. Callers that are also leaving the
  // place view clear those themselves.
  endRouteSession: () =>
    set({
      origin: null,
      originName: "",
      destination: null,
      destinationName: "",
      computeRoutes: null,
      selectRoute: null,
      routeWaypoints: [],
      routeInfoShow: false,
      metroAlerts: null,
      transitAlerts: null,
      sosNavActive: false,
      routeA11y: [],
      activeBusLeg: null,
      liveBusPositions: [],
    }),
});
