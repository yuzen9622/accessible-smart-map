import type { CumulativePath } from "@/lib/geo";
import { plannedRideMinutes } from "@/lib/navigation/transitRide";
import type {
  AccessibleRoute,
  BusDepartureCandidate,
  BusLeg,
  RouteLeg,
} from "@/types/route";
import type { NavigationProgress } from "./navigationProgress";

/**
 * The backend's selected departure for this leg in a bus-arrivals answer.
 * Before boarding the backend may re-select another vehicle of the same
 * service (the rider reached the stop early, or the planned bus ran early), so
 * only the service must match. After boarding the rider is on one vehicle and
 * its plate/trip must match exactly.
 */
function selectedDeparture(
  leg: BusLeg,
  candidates: readonly BusDepartureCandidate[] | undefined,
  boarded: boolean,
): BusDepartureCandidate | null {
  const selected = leg.selectedDeparture;
  if (!selected || (!selected.plateNumb && !selected.tripId)) return null;
  const matches = candidates?.filter(
    (candidate) =>
      candidate.selected &&
      candidate.subRouteUid === selected.subRouteUid &&
      candidate.direction === selected.direction &&
      candidate.departureStopId === selected.departureStopId &&
      candidate.arrivalStopId === selected.arrivalStopId &&
      (!boarded ||
        ((!selected.plateNumb || candidate.plateNumb === selected.plateNumb) &&
          (!selected.tripId || candidate.tripId === selected.tripId))),
  );
  return matches?.length === 1 ? matches[0] : null;
}

export function selectedDepartureLiveMinutes(
  leg: BusLeg,
  candidates: readonly BusDepartureCandidate[] | undefined,
  boarded: boolean,
  now: number,
): number | null {
  const candidate = selectedDeparture(leg, candidates, boarded);
  if (!candidate) return null;
  const source = boarded
    ? candidate.alightingTimeSource
    : candidate.boardingTimeSource;
  const instant = boarded ? candidate.alightingTime : candidate.boardingTime;
  const time = instant ? Date.parse(instant) : NaN;
  return source === "realtime" && Number.isFinite(time)
    ? Math.max(0, Math.ceil((time - now) / 60_000))
    : null;
}

/** While waiting: the selected trip's scheduled boarding time (HH:mm) when it
 * has only a timetable; null when live or unknown. */
export function selectedDepartureTimetable(
  leg: BusLeg,
  candidates: readonly BusDepartureCandidate[] | undefined,
): string | null {
  const candidate = selectedDeparture(leg, candidates, false);
  if (candidate?.boardingTimeSource !== "schedule" || !candidate.boardingTime)
    return null;
  const time = Date.parse(candidate.boardingTime);
  return Number.isFinite(time)
    ? new Date(time).toLocaleTimeString("en-GB", {
        timeZone: "Asia/Taipei",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
}

function travelMinutes(leg: RouteLeg): number | null {
  switch (leg.type) {
    case "WALK":
      return leg.minutesEst;
    case "BUS":
      return plannedRideMinutes(leg);
    case "DRIVE":
    case "MOTORCYCLE":
      return leg.durationInTrafficMin ?? leg.durationMinutes ?? leg.durationMin;
    default:
      return leg.rideMinutes;
  }
}

/** Current stage plus each later leg; waiting is time, never a distance ratio. */
export function estimateNavigationEta(input: {
  route: AccessibleRoute;
  path: CumulativePath;
  progress: NavigationProgress | null;
  currentLegIndex: number;
  boarded: boolean;
  liveBusLegIndex?: number;
  liveMinutes?: number | null;
  now: number;
}): {
  remainingDurationSec: number | null;
  estimatedArrivalAt: number | null;
  etaSource: "realtime" | "estimated";
} {
  let seconds = 0;
  let realtime = false;
  const first = input.progress?.legIndex ?? input.currentLegIndex;
  for (let index = first; index < input.route.legs.length; index++) {
    const leg = input.route.legs[index];
    const duration = travelMinutes(leg);
    const range = input.path.legRanges[index];
    const start = range ? input.path.cumM[range.start] : 0;
    const end = range ? input.path.cumM[range.start + range.count - 1] : 0;
    const fraction =
      index === first && input.progress && end > start
        ? Math.max(
            0,
            Math.min(1, (end - input.progress.alongM) / (end - start)),
          )
        : 1;
    const liveMinutes =
      index === input.liveBusLegIndex &&
      input.liveMinutes != null &&
      Number.isFinite(input.liveMinutes) &&
      input.liveMinutes >= 0
        ? input.liveMinutes
        : null;
    const ridingCurrentBus =
      index === first && (input.boarded || index < input.currentLegIndex);
    if (
      leg.type === "BUS" &&
      index === first &&
      ridingCurrentBus &&
      liveMinutes !== null
    ) {
      seconds += liveMinutes * 60;
      realtime = true;
      continue;
    }
    if (duration == null || !Number.isFinite(duration) || duration < 0)
      return {
        remainingDurationSec: null,
        estimatedArrivalAt: null,
        etaSource: "estimated",
      };
    if (leg.type === "BUS" && ridingCurrentBus) {
      seconds += duration * 60 * fraction;
      continue;
    }
    if (
      "estimatedWaitMinutes" in leg &&
      (index !== first || leg.type !== "BUS" || !input.boarded)
    ) {
      const boardingAt =
        leg.type === "BUS" && leg.selectedDeparture?.boardingTime
          ? Date.parse(leg.selectedDeparture.boardingTime)
          : NaN;
      // Live/absolute departures count from now; planned waits start when
      // the traveler reaches this leg, after the preceding travel time.
      seconds +=
        liveMinutes !== null
          ? Math.max(0, liveMinutes * 60 - seconds)
          : Number.isFinite(boardingAt)
            ? Math.max(0, (boardingAt - input.now) / 1000 - seconds)
            : Math.max(0, leg.estimatedWaitMinutes ?? 0) * 60;
      realtime ||= liveMinutes !== null;
    }
    seconds += duration * 60 * fraction;
  }
  const remainingDurationSec = Math.round(seconds);
  return {
    remainingDurationSec,
    estimatedArrivalAt: input.now + remainingDurationSec * 1000,
    etaSource: realtime ? "realtime" : "estimated",
  };
}
