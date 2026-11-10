"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type CurrentSpeedLimit,
  currentDrivingPosition,
  DRIVING_PROGRESS_MAX_AGE_MS,
  type LaneGuidance,
  laneGuidanceAt,
  speedLimitAt,
} from "@/lib/navigation/roadGuidance";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";

/**
 * The current segment's speed limit and the upcoming maneuver's lanes for a
 * live DRIVE/MOTORCYCLE leg, both read from the selected route's progress.
 */
export default function useDrivingGuidance(): {
  speedLimit: CurrentSpeedLimit | null;
  lanes: LaneGuidance | null;
} {
  const route = useMapStore(
    (s) => s.activeNavigationRoute ?? s.selectRoute?.route,
  );
  const isNavigating = useMapStore((s) => s.isNavigating);
  const progress = useNavStore((s) => s.routeProgress);
  const navigationId = useNavStore((s) => s.navigationId);
  const routeVersion = useNavStore((s) => s.routeVersion);
  const navigationMode = useNavStore((s) => s.navigationMode);
  const arrived = useNavStore((s) => s.arrived);
  const step = useNavStore((s) => s.instructions[s.currentStepIndex]);
  const [now, setNow] = useState(() => Date.now());

  const active = isNavigating && !arrived && navigationMode === "live";
  useEffect(() => {
    if (!active || !progress) return;
    // Re-render when this sample expires, so a stalled GPS stops claiming
    // a segment; a newer sample replaces the timer.
    const expiry = setTimeout(
      () => setNow(Date.now()),
      Math.max(
        0,
        progress.observedAt + DRIVING_PROGRESS_MAX_AGE_MS - Date.now(),
      ) + 1,
    );
    return () => clearTimeout(expiry);
  }, [active, progress]);

  return useMemo(() => {
    const position = active
      ? currentDrivingPosition({
          route,
          progress,
          navigationId,
          routeVersion,
          now,
        })
      : null;
    if (!position) return { speedLimit: null, lanes: null };
    return {
      speedLimit: speedLimitAt(position.leg, position.segmentIndex),
      lanes: laneGuidanceAt(step, position),
    };
  }, [active, route, progress, navigationId, routeVersion, now, step]);
}
