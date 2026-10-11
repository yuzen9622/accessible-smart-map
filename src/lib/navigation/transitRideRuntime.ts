import type { CumulativePath } from "@/lib/geo";
import type { AccessibleRoute, LiveBus, NavInstruction } from "@/types/route";
import type { BusDirection } from "@/types/transit";
import { findBusRuns, legAlongRange } from "./transitRide";

export interface BoardedVehicle {
  plate: string | null;
  direction: BusDirection | null;
  branch: string | null;
}
export interface TransitRideRuntime {
  key: string;
  boarded: boolean;
  vehicle: BoardedVehicle | null;
  candidate: BoardedVehicle | null;
  candidateAt: number;
  sample: { alongM: number; at: number } | null;
  movingSamples: number;
  observedAtStop: boolean;
}
export function newTransitRide(key: string): TransitRideRuntime {
  return {
    key,
    boarded: false,
    vehicle: null,
    candidate: null,
    candidateAt: 0,
    sample: null,
    movingSamples: 0,
    observedAtStop: false,
  };
}
/** Only feeds already resolved to the planned stop/direction/branch are candidates. */
export function rememberVehicle(
  ride: TransitRideRuntime,
  bus: LiveBus | undefined,
  at: number,
): TransitRideRuntime {
  if (ride.boarded || !bus?.isTarget) return ride;
  return {
    ...ride,
    candidate: {
      plate: bus.plateNumb,
      direction: bus.direction,
      branch: bus.subRouteUid ?? null,
    },
    candidateAt: at,
  };
}
export function confirmBoarded(
  ride: TransitRideRuntime,
  at: number,
): TransitRideRuntime {
  return {
    ...ride,
    boarded: true,
    vehicle: at - ride.candidateAt <= 25_000 ? ride.candidate : null,
    sample: null,
    movingSamples: 0,
  };
}
/** Three samples (two valid intervals) after seeing the boarding stop. No distance-only shortcut.
 * Gaps, reversals, implausible speed/jumps or off-route fixes break continuity.
 */
export function sampleBoarding(
  ride: TransitRideRuntime,
  alongM: number,
  boardM: number,
  at: number,
  perpendicularM: number,
): TransitRideRuntime {
  if (ride.boarded) return ride;
  const past = alongM - boardM;
  const previous = ride.sample;
  const dt = previous ? (at - previous.at) / 1000 : 0;
  // React re-runs and sub-second fixes are not new evidence or a new baseline.
  // Off-route fixes still revoke the chain regardless of their timestamp.
  if (previous && dt < 1 && perpendicularM <= 30) return ride;
  const delta = previous ? alongM - previous.alongM : 0;
  const validInterval =
    previous !== null &&
    perpendicularM <= 30 &&
    dt >= 1 &&
    dt <= 15 &&
    delta >= 3 * dt &&
    delta <= 25 * dt &&
    delta <= 180;
  const observedAtStop =
    (validInterval && ride.observedAtStop) ||
    (Math.abs(past) <= 30 && perpendicularM <= 30);
  const continuous = validInterval && observedAtStop;
  const movingSamples = continuous ? ride.movingSamples + 1 : 0;
  const next = {
    ...ride,
    observedAtStop,
    sample: perpendicularM <= 30 ? { alongM, at } : null,
    movingSamples,
  };
  return movingSamples >= 2 && past >= 50 ? confirmBoarded(next, at) : next;
}

export function guardBusProgress(input: {
  instructions: NavInstruction[];
  route: AccessibleRoute;
  cp: CumulativePath;
  currentIndex: number;
  nextIndex: number;
  ride: TransitRideRuntime | null;
  alongM: number;
  perpendicularM: number;
  at: number;
}): {
  nextIndex: number;
  ride: TransitRideRuntime | null;
  waitingGate: boolean;
} {
  let ride = input.ride;
  for (const run of findBusRuns(input.instructions)) {
    if (
      run.alightIndex < input.currentIndex ||
      run.boardIndex > Math.max(input.nextIndex, input.currentIndex)
    )
      continue;
    const key = JSON.stringify([
      input.route.routeToken,
      input.route.navigationId,
      input.route.routeVersion,
      run.legIndex,
    ]);
    const range = legAlongRange(input.cp, run.legIndex);
    ride = ride?.key === key ? ride : newTransitRide(key);
    if (range)
      ride = sampleBoarding(
        ride,
        input.alongM,
        range.startM,
        input.at,
        input.perpendicularM,
      );
    if (!ride.boarded)
      return {
        nextIndex: Math.min(input.nextIndex, run.boardIndex),
        ride,
        waitingGate: true,
      };
  }
  return { nextIndex: input.nextIndex, ride, waitingGate: false };
}

export function matchesBoardedVehicle(
  vehicle: BoardedVehicle,
  bus: LiveBus,
): boolean {
  return (
    vehicle.plate !== null &&
    bus.plateNumb === vehicle.plate &&
    bus.direction === vehicle.direction &&
    (vehicle.branch === null || bus.subRouteUid === vehicle.branch)
  );
}
