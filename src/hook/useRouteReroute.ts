"use client";

import {
  type LocalRerouteContext,
  LocalRerouteCoordinator,
  type LocalRerouteCoordinatorDeps,
  localRerouteCoordinator,
  REROUTE_COOLDOWN_MS,
} from "@/lib/navigation/localRerouteCoordinator";
import type { LatLng } from "@/types";
import type { RerouteReason } from "@/types/route";

export {
  type LocalRerouteContext,
  LocalRerouteCoordinator,
  LocalRerouteCoordinator as LocalRerouteController,
  type LocalRerouteCoordinatorDeps,
  localRerouteCoordinator,
  REROUTE_COOLDOWN_MS,
};

// Module-level so every render sees the same callbacks: callers list them as
// effect deps, and a fresh identity per render re-runs those effects forever.
const rerouteActions = {
  confirmOffRouteEpisode: (position?: LatLng) =>
    localRerouteCoordinator.triggerAutoReroute(position),
  clearOffRouteEpisode: () => localRerouteCoordinator.clearOffRoute(),
  retry: (position?: LatLng) => localRerouteCoordinator.retry(position),
  requestManualReroute: (reason: RerouteReason = "MANUAL", position?: LatLng) =>
    localRerouteCoordinator.triggerManualReroute(reason, position),
};

/**
 * Thin compatibility facade around the single localRerouteCoordinator.
 * Pure imperative methods — no nonces, no useEffect side-effect triggers.
 */
export default function useRouteReroute() {
  return rerouteActions;
}
