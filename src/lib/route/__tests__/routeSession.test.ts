import { describe, expect, it } from "vitest";
import {
  hasRouteSession,
  routeResumeTarget,
  shouldShowRoutePill,
} from "../routeSession";

const EMPTY = {
  computeRoutes: null,
  selectRoute: null,
  destination: null,
};

describe("hasRouteSession", () => {
  it("is false when nothing route-shaped is on the map", () => {
    expect(hasRouteSession(EMPTY)).toBe(false);
  });

  it("is true on destination alone — the pin the old clear lists all forgot", () => {
    // Every pre-session teardown path (BottomSheet's rail click / panel close,
    // confirmNavExit) nulled computeRoutes and selectRoute but never
    // destination, and the map draws its pin from `searchPlace ?? destination`.
    // That orphaned pin is a session, so it gets the pill and its ✕.
    expect(
      hasRouteSession({ ...EMPTY, destination: { lat: 25, lng: 121 } }),
    ).toBe(true);
  });

  it("is true with results but no selection yet", () => {
    expect(hasRouteSession({ ...EMPTY, computeRoutes: [] })).toBe(true);
  });

  it("is true with a selected route", () => {
    expect(hasRouteSession({ ...EMPTY, selectRoute: { index: 0 } })).toBe(true);
  });
});

describe("routeResumeTarget", () => {
  it("returns to the results list when routes came back", () => {
    expect(routeResumeTarget([{}, {}])).toBe("route");
  });

  it("returns to the planning form when only a destination was picked", () => {
    expect(routeResumeTarget(null)).toBe("plan");
  });

  it("treats an empty result array as nothing to show", () => {
    // A zero-length array is "we asked and got nothing", not "here are your
    // routes" — landing on an empty RouteContent would look broken.
    expect(routeResumeTarget([])).toBe("plan");
  });
});

describe("shouldShowRoutePill", () => {
  const base = {
    hasSession: true,
    sheetMode: "home" as const,
    isNavigating: false,
    chatOpen: false,
  };

  it("shows once the user has left the route flow", () => {
    expect(shouldShowRoutePill(base)).toBe(true);
    expect(shouldShowRoutePill({ ...base, sheetMode: "place" })).toBe(true);
    expect(shouldShowRoutePill({ ...base, sheetMode: "station" })).toBe(true);
  });

  it("stays hidden while the user is already inside the route flow", () => {
    expect(shouldShowRoutePill({ ...base, sheetMode: "plan" })).toBe(false);
    expect(shouldShowRoutePill({ ...base, sheetMode: "route" })).toBe(false);
  });

  it("stays hidden during navigation — the HUD is the route's presence there", () => {
    expect(
      shouldShowRoutePill({
        ...base,
        sheetMode: "navigation",
        isNavigating: true,
      }),
    ).toBe(false);
    // Even if sheetMode hasn't caught up with isNavigating yet.
    expect(shouldShowRoutePill({ ...base, isNavigating: true })).toBe(false);
  });

  it("shows over the AI assistant even though sheetMode still says route", () => {
    // The assistant is painted over the panel slot, so the route panel isn't
    // on screen at all — and on mobile at peek height the sheet header (with
    // its back button) is hidden too, leaving nothing to return by.
    expect(
      shouldShowRoutePill({ ...base, sheetMode: "route", chatOpen: true }),
    ).toBe(true);
    expect(
      shouldShowRoutePill({ ...base, sheetMode: "plan", chatOpen: true }),
    ).toBe(true);
  });

  it("stays hidden during navigation even with the chat open", () => {
    // The assistant can't take the slot mid-navigation; the HUD owns it.
    expect(
      shouldShowRoutePill({ ...base, isNavigating: true, chatOpen: true }),
    ).toBe(false);
  });

  it("stays hidden with no session", () => {
    expect(shouldShowRoutePill({ ...base, hasSession: false })).toBe(false);
    expect(
      shouldShowRoutePill({ ...base, hasSession: false, chatOpen: true }),
    ).toBe(false);
  });
});
