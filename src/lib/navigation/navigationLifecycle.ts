import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import { localRerouteCoordinator } from "./localRerouteCoordinator";

/**
 * Explicit domain command to start navigation.
 * Synchronously starts a fresh coordinator session before activating the UI.
 */
export function startNavigation(): void {
  const map = useMapStore.getState();
  const nav = useNavStore.getState();
  const navigationId =
    nav.navigationId ?? map.selectRoute?.route.navigationId ?? null;
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
