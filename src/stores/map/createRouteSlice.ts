"use client";
import { advanceVenueJourney } from "@/lib/indoor/journey";
import { isVenueTourAllowed } from "@/lib/indoor/tour";
import type { MapSliceCreator, MapStore, RouteSlice } from "./types";

export const createRouteSlice: MapSliceCreator<RouteSlice> = (set, get) => ({
  busSelection: null,
  venueJourney: null,
  setVenueJourney: (journey) => {
    const outdoor = journey?.outdoor;
    const selected = outdoor?.routes[outdoor.selectedIndex];
    set({
      venueJourney: journey,
      busSelection: null,
      routeGeneration: get().routeGeneration + 1,
      activeNavigationRoute: null,
      isNavigating: false,
      planId: journey?.id ?? null,
      selectedRouteId: selected?.routeId ?? journey?.id ?? null,
      effectivePreferences: null,
      aiRouteMetadata: null,
      computeRoutes: outdoor?.routes ?? null,
      selectRoute: selected
        ? { index: outdoor?.selectedIndex ?? 0, route: selected }
        : null,
      routeWaypoints: [],
      metroAlerts: null,
      transitAlerts: null,
      activeBusLeg: null,
      liveBusPositions: [],
      routeInfoShow: Boolean(journey),
      ...(journey
        ? {
            origin: outdoor?.origin ?? journey.from,
            destination: journey.to,
            originName: outdoor
              ? outdoor.origin.kind === "place"
                ? outdoor.origin.place.name
                : outdoor.origin.address
              : journey.from.name,
            destinationName: journey.to.name,
            sheetMode: "route" as const,
            routeSubPanel: "none" as const,
            sidebarCollapsed: false,
            chatOpen: false,
          }
        : {}),
    });
  },
  setVenueJourneyPreview: (patch) => {
    const journey = get().venueJourney;
    if (!journey || !["idle", "touring"].includes(journey.guidance.status))
      return;
    const progress = patch.progress ?? journey.preview.progress;
    if (
      !Number.isFinite(progress) ||
      (patch.direction !== undefined &&
        patch.direction !== 1 &&
        patch.direction !== -1)
    )
      return;
    set({
      venueJourney: {
        ...journey,
        preview: {
          ...journey.preview,
          ...patch,
          progress: Math.max(0, Math.min(1, progress)),
          playing: (
            journey.guidance.status === "touring"
              ? isVenueTourAllowed(journey.route)
              : journey.route.animationSafe
          )
            ? (patch.playing ?? journey.preview.playing)
            : false,
        },
      },
    });
  },
  startVenueTour: (autoplay = true) => {
    const journey = get().venueJourney;
    if (!journey || !isVenueTourAllowed(journey.route)) return;
    set({
      venueJourney: {
        ...journey,
        preview: {
          progress: 0,
          direction: 1,
          playing: autoplay,
          following: false,
        },
        guidance: { status: "touring", stepIndex: 0 },
      },
      activeNavigationRoute: null,
    });
  },
  startVenueGuidance: () => {
    const journey = get().venueJourney;
    if (!journey) return;
    set({
      venueJourney: {
        ...journey,
        preview: { ...journey.preview, playing: false },
        guidance: { status: "guiding", stepIndex: 0 },
      },
      activeNavigationRoute: null,
    });
  },
  advanceVenueGuidance: () => {
    const journey = get().venueJourney;
    if (journey) set({ venueJourney: advanceVenueJourney(journey) });
  },
  stopVenueGuidance: () => {
    const journey = get().venueJourney;
    if (journey)
      set({
        venueJourney: {
          ...journey,
          guidance: { status: "idle", stepIndex: 0 },
          preview: { ...journey.preview, playing: false },
        },
      });
  },
  beginVenueOutdoorNavigation: () => {
    const journey = get().venueJourney;
    if (journey?.outdoor)
      set({
        venueJourney: {
          ...journey,
          preview: { ...journey.preview, playing: false },
          guidance: { status: "outdoor", stepIndex: 0 },
        },
      });
  },
  activeNavigationRoute: null,
  routeGeneration: 0,
  planId: null,
  selectedRouteId: null,
  effectivePreferences: null,
  aiRouteMetadata: null,
  invalidRouteTokens: [],
  invalidateRouteToken: (token) =>
    set({
      invalidRouteTokens: [...get().invalidRouteTokens, token],
      routeGeneration: get().routeGeneration + 1,
    }),
  applyAiRoutePlan: (plan) => {
    const index = plan.routes.findIndex(
      (route) => route.routeId === plan.selectedRouteId,
    );
    if (index < 0) return;
    set({
      busSelection: null,
      venueJourney: null,
      ...(get().venueJourney
        ? { isNavigating: false, activeNavigationRoute: null }
        : {}),
      routeGeneration: get().routeGeneration + 1,
      planId: plan.planId,
      selectedRouteId: plan.selectedRouteId,
      effectivePreferences: plan.effectivePreferences,
      aiRouteMetadata: {
        alerts: plan.alerts,
        arrivalEntrance: plan.arrivalEntrance,
      },
      origin: {
        kind: "coordinate",
        address: plan.origin.name,
        position: plan.origin,
      },
      destination: {
        kind: "coordinate",
        address: plan.destination.name,
        position: plan.destination,
      },
      originName: plan.origin.name,
      destinationName: plan.destination.name,
      computeRoutes: plan.routes,
      selectRoute: { index, route: plan.routes[index] },
      metroAlerts: plan.metroAlerts ?? null,
      transitAlerts: plan.transitAlerts ?? null,
      routeWaypoints: [],
      routeInfoShow: true,
      activeBusLeg: null,
      liveBusPositions: [],
      sheetMode: "route",
      routeSubPanel: "none",
      sidebarCollapsed: false,
      chatOpen: false,
    });
  },
  origin: null,
  setOrigin: (origin) => set({ origin }),
  destination: null,
  setDestination: (destination) => set({ destination }),
  originName: "",
  setOriginName: (name) => set({ originName: name }),
  destinationName: "",
  setDestinationName: (name) => set({ destinationName: name }),
  computeRoutes: null,
  setComputeRoutes: (routes) => {
    const state = get();
    const selected = routes?.find(
      (route) => route === state.selectRoute?.route,
    );
    set({
      busSelection: null,
      venueJourney: null,
      ...(state.venueJourney
        ? { isNavigating: false, activeNavigationRoute: null }
        : {}),
      routeGeneration: state.routeGeneration + 1,
      computeRoutes: routes,
      selectRoute:
        selected && routes
          ? { index: routes.indexOf(selected), route: selected }
          : null,
      selectedRouteId: selected?.routeId ?? null,
      ...(selected
        ? {}
        : { planId: null, effectivePreferences: null, aiRouteMetadata: null }),
      ...(!routes
        ? { metroAlerts: null, transitAlerts: null, routeWaypoints: [] }
        : {}),
    });
  },
  selectRoute: null,
  setRouteSelect: (route) => {
    if (!route) {
      set({
        busSelection: null,
        selectRoute: null,
        selectedRouteId: null,
        routeGeneration: get().routeGeneration + 1,
        activeBusLeg: null,
        liveBusPositions: [],
      });
      return;
    }
    const prev = get().selectRoute;
    const selected =
      route.route ?? get().computeRoutes?.[route.index ?? -1] ?? prev?.route;
    if (!selected) return;
    const journey = get().venueJourney;
    const journeyIndex = journey?.outdoor?.routes.indexOf(selected) ?? -1;
    const next = {
      ...(selected === prev?.route ? {} : { busSelection: null }),
      ...(journey
        ? {
            venueJourney:
              journey.outdoor && journeyIndex >= 0
                ? {
                    ...journey,
                    outdoor: {
                      ...journey.outdoor,
                      selectedIndex: journeyIndex,
                    },
                  }
                : null,
          }
        : {}),
      selectedRouteId: selected.routeId,
      routeGeneration:
        get().routeGeneration + (selected === prev?.route ? 0 : 1),
      selectRoute: {
        ...prev,
        ...route,
        route: selected,
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
      busSelection: null,
      venueJourney: null,
      ...(get().venueJourney
        ? { isNavigating: false, activeNavigationRoute: null }
        : {}),
      routeGeneration: get().routeGeneration + 1,
      planId: null,
      selectedRouteId: null,
      effectivePreferences: null,
      aiRouteMetadata: null,
      invalidRouteTokens: [],
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
