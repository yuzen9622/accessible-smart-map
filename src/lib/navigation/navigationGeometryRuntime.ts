import {
  buildCumulativePath,
  type CumulativePath,
  resolveWaypoints,
  type Waypoint,
} from "@/lib/geo";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute, NavInstruction } from "@/types/route";

export interface NavigationGeometryRuntime {
  path: CumulativePath | null;
  waypoints: Waypoint[];
}

export function createNavigationGeometryRuntime(): NavigationGeometryRuntime {
  return { path: null, waypoints: [] };
}

export function replaceNavigationGeometryRuntime(
  runtime: NavigationGeometryRuntime,
  route: AccessibleRoute,
  instructions: NavInstruction[],
): void {
  const path = buildCumulativePath(route.legs);
  runtime.path = path;
  runtime.waypoints = resolveWaypoints(instructions, path);
}

/**
 * Keeps the local projection engine aligned with an atomic store replacement.
 * Zustand subscriptions run synchronously, so the new path is installed before
 * the replacement call returns and does not depend on instruction HTTP timing.
 */
export function observeLocalNavigationGeometry(
  runtime: NavigationGeometryRuntime,
): () => void {
  const sync = () => {
    const route = useMapStore.getState().selectRoute?.route;
    const nav = useNavStore.getState();
    if (nav.navigationSource === "voice") {
      runtime.path = null;
      runtime.waypoints = [];
      return;
    }
    if (
      !route?.navigationId ||
      nav.navigationId !== route.navigationId ||
      nav.routeVersion !== (route.routeVersion ?? 0)
    ) {
      runtime.path = null;
      runtime.waypoints = [];
      return;
    }
    replaceNavigationGeometryRuntime(runtime, route, nav.instructions);
  };

  sync();
  const unsubscribeMap = useMapStore.subscribe((state, previous) => {
    if (state.selectRoute?.route !== previous.selectRoute?.route) sync();
  });
  const unsubscribeNav = useNavStore.subscribe((state, previous) => {
    if (
      state.navigationSource !== previous.navigationSource ||
      state.navigationId !== previous.navigationId ||
      state.routeVersion !== previous.routeVersion ||
      state.instructions !== previous.instructions
    ) {
      sync();
    }
  });
  return () => {
    unsubscribeMap();
    unsubscribeNav();
  };
}
