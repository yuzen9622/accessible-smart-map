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

/**
 * Thin compatibility facade around the single localRerouteCoordinator.
 * Pure imperative methods — no nonces, no useEffect side-effect triggers.
 */
export default function useRouteReroute() {
  return {
    confirmOffRouteEpisode: (position?: LatLng) =>
      localRerouteCoordinator.triggerAutoReroute(position),
    clearOffRouteEpisode: () => localRerouteCoordinator.clearOffRoute(),
    retry: (position?: LatLng) => localRerouteCoordinator.retry(position),
    requestManualReroute: (
      reason: RerouteReason = "MANUAL",
      position?: LatLng,
    ) => localRerouteCoordinator.triggerManualReroute(reason, position),
  };
}
