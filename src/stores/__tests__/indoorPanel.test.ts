import { beforeEach, describe, expect, it } from "vitest";
import useMapStore from "@/stores/useMapStore";

beforeEach(() => {
  useMapStore.getState().setIndoorExploring(false);
  useMapStore.setState(useMapStore.getInitialState());
});

describe("indoor content in the original map sheet", () => {
  it("enters the whole map in 3D and keeps that mode when returning to the exterior", () => {
    useMapStore.setState({ is3D: false });
    useMapStore.getState().setIndoorExploring(true);
    expect(useMapStore.getState()).toMatchObject({
      indoorExploring: true,
      is3D: true,
    });
    useMapStore.getState().setIndoorExploring(false);
    expect(useMapStore.getState()).toMatchObject({
      indoorExploring: false,
      is3D: true,
    });
    // The explicit 2D control is authoritative during teardown too.
    useMapStore.getState().setIndoorExploring(true);
    useMapStore.setState({ is3D: false });
    useMapStore.getState().setIndoorExploring(false);
    expect(useMapStore.getState().is3D).toBe(false);
  });
  it("cannot open an indoor panel without an active indoor model", () => {
    useMapStore.getState().setIndoorPanelOpen(true);
    expect(useMapStore.getState().indoorPanelOpen).toBe(false);
  });

  it("preserves the outdoor session and keeps the current navigation UI visible on exit", () => {
    const routes = useMapStore.getState().computeRoutes ?? [];
    const waypoints = [{ lat: 10, lng: 20 }];
    useMapStore.setState({
      sheetMode: "navigation",
      isNavigating: true,
      planId: "existing-outdoor-plan",
      selectedRouteId: "existing-selection",
      routeGeneration: 4,
      computeRoutes: routes,
      routeWaypoints: waypoints,
      chatOpen: true,
      sidebarCollapsed: true,
      mobileSheetSnap: "full",
    });

    useMapStore.getState().setIndoorExploring(true);
    expect(useMapStore.getState()).toMatchObject({
      indoorExploring: true,
      indoorPanelOpen: false,
      sidebarCollapsed: false,
      mobileSheetSnap: "half",
      sheetMode: "navigation",
      isNavigating: true,
      chatOpen: true,
    });
    useMapStore.getState().setIndoorExploring(false);
    const state = useMapStore.getState();
    expect(state).toMatchObject({
      indoorExploring: false,
      indoorPanelOpen: false,
      sidebarCollapsed: false,
      mobileSheetSnap: "half",
      sheetMode: "navigation",
      isNavigating: true,
      chatOpen: true,
      planId: "existing-outdoor-plan",
      selectedRouteId: "existing-selection",
      routeGeneration: 4,
    });
    expect(state.computeRoutes).toBe(routes);
    expect(state.routeWaypoints).toBe(waypoints);
  });

  it("does not overwrite the presentation snapshot on repeated enter calls", () => {
    useMapStore.setState({ sidebarCollapsed: true, mobileSheetSnap: "peek" });
    useMapStore.getState().setIndoorExploring(true);
    useMapStore.getState().setMobileSheetSnap("full");
    useMapStore.getState().setIndoorExploring(true);
    useMapStore.getState().setIndoorExploring(false);
    expect(useMapStore.getState()).toMatchObject({
      sidebarCollapsed: true,
      mobileSheetSnap: "peek",
    });
  });

  it("lets an original rail action take the same content slot without exiting indoors", () => {
    useMapStore.setState({ planId: "retained-plan" });
    useMapStore.getState().setIndoorExploring(true);
    useMapStore.getState().setActiveRailPanel("search");
    expect(useMapStore.getState()).toMatchObject({
      indoorExploring: true,
      indoorPanelOpen: false,
      activeRailPanel: "search",
      planId: "retained-plan",
    });
  });

  it("lets an original route panel take the slot without replacing its plan", () => {
    useMapStore.setState({
      planId: "retained-plan",
      sidebarCollapsed: true,
      mobileSheetSnap: "peek",
    });
    useMapStore.getState().setIndoorExploring(true);
    useMapStore.getState().setSheetMode("route");
    expect(useMapStore.getState()).toMatchObject({
      indoorExploring: true,
      indoorPanelOpen: false,
      sheetMode: "route",
      planId: "retained-plan",
    });
    // Zooming back out must not restore the old, collapsed home presentation
    // over the route that was opened while browsing the building.
    useMapStore.getState().setIndoorExploring(false);
    expect(useMapStore.getState()).toMatchObject({
      indoorExploring: false,
      sheetMode: "route",
      sidebarCollapsed: false,
      mobileSheetSnap: "half",
      planId: "retained-plan",
    });
  });

  it("reopens the shared panel while keeping the underlying assistant and snap", () => {
    useMapStore.getState().setIndoorExploring(true);
    useMapStore.getState().setIndoorPanelOpen(false);
    useMapStore.setState({
      sidebarCollapsed: true,
      chatOpen: true,
      mobileSheetSnap: "peek",
    });
    useMapStore.getState().setIndoorPanelOpen(true);
    expect(useMapStore.getState()).toMatchObject({
      indoorPanelOpen: true,
      sidebarCollapsed: false,
      chatOpen: true,
      mobileSheetSnap: "peek",
    });
  });
});
