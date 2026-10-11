import { toast } from "sonner";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import { localRerouteCoordinator } from "./localRerouteCoordinator";

/**
 * Explicit domain command to start navigation.
 * Synchronously starts a fresh coordinator session before activating the UI.
 */
export function startNavigation(): void {
  const map = useMapStore.getState();
  const route = map.selectRoute?.route;
  if (!route?.routeToken || map.invalidRouteTokens.includes(route.routeToken)) {
    toast.error("這份路線目前無法啟用導航，請重新規劃。");
    return;
  }
  // VoiceSessionHost installs authoritative steps before invoking this command.
  // Starting its map UI must not reset that owner or its carried instructions.
  if (useNavStore.getState().navigationSource !== "voice") {
    useNavStore.getState().reset();
    useNavStore
      .getState()
      .setNavigationIdentity(
        route.navigationId ?? null,
        route.routeVersion ?? 0,
      );
  }
  useMapStore.setState({ activeNavigationRoute: route });
  const navigationId = route.navigationId ?? null;
  localRerouteCoordinator.startSession(navigationId);
  map.setIsNavigating(true);
}

/**
 * Explicit domain command to stop navigation.
 * Synchronously aborts in-flight reroute requests and tears down the session.
 */
export function stopNavigation(): void {
  localRerouteCoordinator.stopSession();
  useMapStore.getState().setIsNavigating(false);
  useNavStore.getState().reset();
}
