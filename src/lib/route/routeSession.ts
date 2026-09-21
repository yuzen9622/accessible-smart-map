import type { SheetMode } from "@/stores/map/types";

/**
 * A "route session" is everything the user built up by planning a route:
 * the destination they picked, the routes that came back, and the one they
 * selected. It is deliberately *not* the same thing as "which panel is open".
 *
 * Before this module existed, the two were kept in sync by hand: four
 * separate copies of a hand-written clear list (`BottomSheet`'s rail click,
 * its collapsed variant, its panel close, and `confirmNavExit`) each nulled
 * a slightly different subset of the route fields whenever the user switched
 * panels. Every one of those copies forgot `origin`/`destination`, and the
 * map's destination pin reads `searchPlace ?? destination` (see `ClientMap`),
 * so the pin outlived every panel switch while the polyline vanished — the
 * "面板關了、線沒了、pin 還在" report.
 *
 * The invariant this file exists to make true, and keep true:
 *
 *   route geometry is on the map  ⟺  there is a visible control that both
 *                                     returns to it and ends it.
 *
 * Switching panels no longer destroys anything. Ending a session is an
 * explicit act, and it happens in exactly one place (`endRouteSession` in
 * the route slice).
 */
export interface RouteSessionSnapshot {
  computeRoutes: unknown[] | null;
  selectRoute: unknown | null;
  destination: unknown | null;
}

/**
 * True while anything route-shaped is still drawn on the map.
 *
 * `destination` counts on its own: a user who picked a destination but
 * backed out before the routes came back still has a pin sitting on the map,
 * and that pin needs the same door out as a full result set. `destination`
 * is only ever written from route-planning entry points (PlaceContent's
 * 規劃路線, `PlanInput`, `A11yCard`, the SOS tracker and the shared-link
 * hydrator), never by plain search — so it can't fire spuriously.
 */
export function hasRouteSession(snapshot: RouteSessionSnapshot): boolean {
  return (
    snapshot.computeRoutes !== null ||
    snapshot.selectRoute !== null ||
    snapshot.destination !== null
  );
}

export type RouteResumeTarget = Extract<SheetMode, "plan" | "route">;

/**
 * Where "回到路線" should land. Results exist → the comparison list the user
 * was last looking at; destination only → the planning form, with their
 * origin/destination still filled in.
 */
export function routeResumeTarget(
  computeRoutes: unknown[] | null,
): RouteResumeTarget {
  return computeRoutes && computeRoutes.length > 0 ? "route" : "plan";
}

/**
 * The single selector deciding whether the resume pill is on screen —
 * imported by the pill itself and by its tests so no surface can compute a
 * second, disagreeing answer (same arrangement as `shouldShowVoicePill`).
 *
 * Hidden while the user is already inside the route flow (`plan`/`route`),
 * and during navigation, where the HUD is the route's on-screen presence.
 *
 * `chatOpen` overrides the route-flow exemption: the AI assistant is painted
 * over the panel slot, so `sheetMode` still says "route" while the route panel
 * is nowhere on screen. On mobile at peek height the sheet header is hidden
 * too, which leaves a route drawn on the map with nothing at all offering a
 * way back to it — the exact hole this pill exists to close. (Tapping it
 * closes the chat on its own: every `setSheetMode` clears `chatOpen`.)
 */
export function shouldShowRoutePill(args: {
  hasSession: boolean;
  sheetMode: SheetMode;
  isNavigating: boolean;
  chatOpen: boolean;
}): boolean {
  if (!args.hasSession || args.isNavigating) return false;
  if (args.chatOpen) return true;
  return (
    args.sheetMode !== "plan" &&
    args.sheetMode !== "route" &&
    args.sheetMode !== "navigation"
  );
}
