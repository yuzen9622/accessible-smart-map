import { useEffect, useRef } from "react";
import type { RouteDetailStop } from "@/lib/api/transit";
import { getBusArrival, getLiveBusPositions } from "@/lib/api/transit";
import {
  resolveCurrentStopSeq,
  resolveLegRide,
} from "@/lib/transit/busLegStops";
import { fetchRouteDetailCached } from "@/lib/transit/busRouteDetailCache";
import useMapStore from "@/stores/useMapStore";
import type { BusLeg, LiveBus } from "@/types/route";

const POLL_INTERVAL_MS = 15_000;

/**
 * The name TDX answers to for this ride. A line's sub-routes (99 / 99延) have
 * separate stop lists and separate vehicles, and the planner tells us which one
 * it booked — querying the parent name returns both mixed together.
 */
function tdxRouteName(leg: BusLeg): string {
  return leg.subRouteName ?? leg.routeName;
}

/**
 * Whether a record belongs to the run this leg rides.
 *
 * Kept as a second line of defence behind {@link tdxRouteName}: a parent-name
 * query still answers with every sub-route, and a 99延 vehicle serves stops the
 * 99 rider never reaches. Records carrying no sub-route are accepted — a
 * backend that cannot say is not evidence of a mismatch.
 */
function onLegSubRoute(leg: BusLeg, subRouteUid?: string): boolean {
  if (!leg.subRouteUid || !subRouteUid) return true;
  return leg.subRouteUid === subRouteUid;
}

interface ArrivalTarget {
  /** Plate of the next bus at the boarding stop, if TDX has dispatched one. */
  plate?: string;
  /** Soonest ETA (minutes) at the boarding stop for this leg's direction. */
  eta: number | null;
}

/**
 * The next vehicle at the boarding stop, from the arrival (ETA) feed.
 *
 * The backend now maps TDX's plate into each arrival entry, so the soonest
 * arrival tells us both *when* the next bus comes and *which plate* it is —
 * the single most reliable way to pin "the bus you're about to board".
 */
async function fetchArrival(
  leg: BusLeg,
  direction: 0 | 1,
): Promise<ArrivalTarget> {
  try {
    const res = await getBusArrival(
      tdxRouteName(leg),
      leg.departureStop,
      direction,
      leg.tdxCity,
    );
    if (!res.ok || !res.data?.arrivals) return { eta: null };

    const next = res.data.arrivals
      .filter(
        (a) =>
          onLegSubRoute(leg, a.subRouteUid) &&
          a.direction === direction &&
          typeof a.estimateMinutes === "number",
      )
      .sort(
        (a, b) => (a.estimateMinutes as number) - (b.estimateMinutes as number),
      )[0];
    if (!next) return { eta: null };

    const plate =
      next.plateNumb && next.plateNumb !== "-1" ? next.plateNumb : undefined;
    return { plate, eta: next.estimateMinutes ?? null };
  } catch {
    return { eta: null };
  }
}

/**
 * Decide which live vehicle is "the one the user is about to board".
 *
 * The only trustworthy signal is the arrival feed at the *boarding stop*: a
 * vehicle it names is, by definition, still on its way to where the user waits.
 *
 * `leg.nearestBus` used to be a fallback, but it is a snapshot taken when the
 * route was planned — minutes or an hour before departure. Pinning it made the
 * map track a vehicle running the line *now* rather than the trip the user
 * plans to take, which then marked every stop it had already served as 已過站
 * and hid their scheduled times. A vehicle that has already left the boarding
 * stop cannot be the one the user boards.
 *
 * Returns undefined when no vehicle is dispatched for this trip yet: no marker
 * is better than a marker for someone else's bus.
 */
function resolveTargetPlate(
  buses: LiveBus[],
  arrivalPlate?: string,
): string | undefined {
  if (arrivalPlate && buses.some((b) => b.plateNumb === arrivalPlate)) {
    return arrivalPlate;
  }
  return undefined;
}

/**
 * Resolve the single vehicle the user is about to board on this leg.
 *
 * Returns an empty array when no plate can be pinned: an unidentifiable bus is
 * worse than none, because a marker for "some vehicle on this line" reads as
 * "your vehicle".
 */
export async function fetchLeg(
  leg: BusLeg,
  signal: AbortSignal,
): Promise<LiveBus[]> {
  // Resolve the published run before asking TDX anything. `leg.direction` on
  // its own has pointed at the opposite direction of a line, which pinned a
  // vehicle heading away from the user and showed its arrival time for a
  // journey they were not taking. The route-detail payload is already warmed
  // by the stop list, so this is normally a cache read.
  const city = leg.tdxCity ?? leg.cityCode ?? "";
  const directions = city
    ? await fetchRouteDetailCached(tdxRouteName(leg), city)
    : null;
  const ride = resolveLegRide(directions ?? undefined, leg);
  const direction = ride?.direction ?? leg.direction;

  // ETA and positions are independent; run them together.
  const [arrival, posRes] = await Promise.all([
    fetchArrival(leg, direction),
    getLiveBusPositions(tdxRouteName(leg), leg.tdxCity, direction, signal),
  ]);

  if (!posRes.ok || !posRes.data?.buses?.length) return [];

  const buses = posRes.data.buses.filter((b) =>
    onLegSubRoute(leg, b.subRouteUid),
  );
  const targetPlate = resolveTargetPlate(buses, arrival.plate);
  if (!targetPlate) return [];

  const target = buses.find((b) => b.plateNumb === targetPlate);
  if (!target) return [];

  // Last guard: a vehicle already past the boarding stop cannot be the one the
  // user boards, whatever the feeds say. Without this, a stale or mislabelled
  // record shows "已過站" all down the stop list next to a countdown to that
  // same boarding stop — two claims that cannot both be true.
  if (ride && hasPassedBoardingStop(ride.stops, target)) return [];

  // `targetPlate` can only be the plate the arrival record named, so the ETA
  // below describes this very vehicle — one bus's plate must never sit beside
  // another bus's countdown.
  return [
    {
      ...target,
      routeName: leg.routeName,
      city: leg.tdxCity ?? "",
      isTarget: true,
      estimateTime: arrival.eta,
      etaStopName: leg.departureStop,
    },
  ];
}

/**
 * True when the vehicle can be placed on the ride *beyond* its first stop.
 *
 * Only decides when the vehicle is close enough to a stop to be located at all;
 * between stops `resolveCurrentStopSeq` returns null and we keep tracking.
 */
function hasPassedBoardingStop(
  stops: RouteDetailStop[],
  bus: { lat: number; lng: number },
): boolean {
  const seq = resolveCurrentStopSeq(stops, bus);
  if (seq == null) return false;
  const board = stops[0]?.seq;
  return board != null && seq > board;
}

/**
 * Polls the live position of the one bus the user is tracking — the leg they
 * expanded (`activeBusLeg`) — every 15s, and reports only that vehicle.
 *
 * Selecting a route no longer starts anything: with no active leg the hook
 * registers no timer and no listener, so a freshly planned route costs zero
 * requests until the user asks for a specific segment.
 *
 * - Fetches through the shared API layer (`END_POINT` config, not a hardcoded
 *   host) so it works in local dev.
 * - Cancels in-flight requests on leg change / unmount via AbortController.
 * - Restarts only when `activeBusLeg.key` changes, not on every re-render.
 * - Pauses while the tab is hidden and refreshes immediately on return.
 * - Keeps the last good position on a transient error instead of blanking.
 */
export function useLiveBusPositions(): void {
  const activeBusLeg = useMapStore((s) => s.activeBusLeg);
  const setLiveBusPositions = useMapStore((s) => s.setLiveBusPositions);

  // Exposes the freshest leg object to the polling loop without making the
  // loop restart on every re-render — only the key below does that.
  const legRef = useRef<BusLeg | null>(activeBusLeg?.leg ?? null);
  legRef.current = activeBusLeg?.leg ?? null;

  const legKey = activeBusLeg?.key ?? null;

  // `legKey` is the intended restart key: the loop reads the freshest leg from
  // `legRef`, so the effect must NOT also depend on the leg object reference.
  useEffect(() => {
    const leg = legRef.current;
    if (!legKey || !leg) {
      setLiveBusPositions([]);
      return;
    }

    let cancelled = false;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = async () => {
      const current = legRef.current;
      if (!current) return;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;

      try {
        const buses = await fetchLeg(current, signal);
        if (cancelled || signal.aborted) return;
        setLiveBusPositions(buses);
      } catch {
        // Transient failure: keep the last good position, next tick retries.
      }
    };

    // Exactly one pending timer at any time: scheduleNext() always clears the
    // previous one before arming a new one, so overlapping triggers (e.g. the
    // tab being refocused mid-refresh) can never double the polling rate. The
    // gap is measured *after* each refresh settles, so a slow request never
    // stacks behind the next tick.
    function scheduleNext() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, POLL_INTERVAL_MS);
    }

    async function tick() {
      if (typeof document !== "undefined" && document.hidden) {
        scheduleNext();
        return;
      }
      await refresh();
      if (!cancelled) scheduleNext();
    }

    function onVisibility() {
      if (!cancelled && !document.hidden) tick();
    }

    tick();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      setLiveBusPositions([]);
    };
  }, [legKey, setLiveBusPositions]);
}
