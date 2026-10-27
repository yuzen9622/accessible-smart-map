import { useEffect, useRef } from "react";
import { useAppTranslation } from "@/i18n/client";
import { getAppLanguage } from "@/i18n/language";
import type { BusLanguage, RouteDetailStop } from "@/lib/api/transit";
import { getLiveBusPositions } from "@/lib/api/transit";
import type { BoardedVehicle } from "@/lib/navigation/transitRideRuntime";
import {
  type ResolvedLegRide,
  resolveCurrentStopSeq,
  resolveLegRide,
} from "@/lib/transit/busLegStops";
import {
  fetchRouteDetailCached,
  legRouteDetailRef,
  peekRouteDetailSnapshot,
} from "@/lib/transit/busRouteDetailCache";
import useMapStore from "@/stores/useMapStore";
import type { BusLeg, LiveBus } from "@/types/route";

const POLL_INTERVAL_MS = 15_000;
/**
 * A tracked vehicle disappears if no poll has refreshed it by then: one poll
 * gap plus the 10s request timeout. Older than that, its position and ETA
 * describe a bus that has moved on.
 */
const STALE_AFTER_MS = POLL_INTERVAL_MS + 10_000;

/**
 * Whether a record belongs to the branch the ride was resolved to.
 *
 * A known branch requires a matching record ID, including when route-detail
 * was queried with subRouteUid. Only an unscoped, unidentified unique run can
 * use the legacy plate/stop fallback; scoped results never prove global uniqueness.
 */
function onResolvedBranch(
  ride: ResolvedLegRide,
  recordUid?: string,
  requestedUid?: string,
): boolean {
  const knownUid = ride.subRouteUid ?? requestedUid;
  // A branch-scoped snapshot cannot prove that unscoped arrival/positions
  // contain only this branch. Known identity requires explicit confirmation.
  if (knownUid) return recordUid === knownUid;
  return ride.singleBranchInDirection;
}

/**
 * Resolve the single vehicle the user is about to board on this leg.
 *
 * Returns an empty array when no plate can be pinned: an unidentifiable bus is
 * worse than none, because a marker for "some vehicle on this line" reads as
 * "your vehicle". The plate comes from the backend-matched planned trip at the
 * *boarding stop*; `leg.nearestBus` is a planning-time snapshot and is not
 * used.
 *
 * The run is resolved from route-detail first: when it cannot be resolved to
 * exactly one run (or resolves to 255, "direction unknown") nothing is
 * tracked — falling back to `leg.direction` would query a run the ride may not
 * be on.
 */
export async function fetchLeg(
  leg: BusLeg,
  signal: AbortSignal,
  boardedVehicle?: BoardedVehicle | null,
  lang?: BusLanguage,
): Promise<LiveBus[]> {
  const ref = legRouteDetailRef(leg);
  if (signal.aborted || !ref.city || !leg.planContext) return [];

  const directions = await fetchRouteDetailCached(ref.routeName, ref.city, {
    lang,
    subRouteUid: ref.subRouteUid,
    planContext: leg.planContext,
    signal,
  });
  if (signal.aborted) return [];

  const ride = resolveLegRide(directions ?? undefined, leg);
  if (!ride || ride.direction === 255) return [];

  const locked = boardedVehicle !== undefined;
  if (
    locked &&
    (!boardedVehicle?.plate ||
      boardedVehicle.direction !== ride.direction ||
      (boardedVehicle.branch !== null &&
        boardedVehicle.branch !== ride.subRouteUid))
  )
    return [];
  const board = locked ? ride.stops.at(-1) : ride.stops[0];
  const arrival = {
    plate: locked ? boardedVehicle?.plate : board?.plateNumb,
    eta:
      locked && board?.plateNumb !== boardedVehicle?.plate
        ? null
        : board?.estimateMinutes,
    subRouteUid: ride.subRouteUid,
  };
  if (!arrival.plate || (!locked && arrival.eta == null)) return [];
  if (
    leg.selectedDeparture?.plateNumb &&
    arrival.plate !== leg.selectedDeparture.plateNumb
  )
    return [];
  const posRes = await getLiveBusPositions(
    ref.routeName,
    ref.city,
    ride.direction,
    signal,
    lang,
  );
  if (signal.aborted) return [];

  if (!arrival.plate || (!locked && arrival.eta == null)) return [];
  if (!posRes.ok || !posRes.data?.buses?.length) return [];

  const target = posRes.data.buses.find(
    (b) =>
      b.plateNumb === arrival.plate &&
      b.direction === ride.direction &&
      onResolvedBranch(ride, b.subRouteUid, leg.subRouteUid) &&
      (!arrival.subRouteUid ||
        !b.subRouteUid ||
        arrival.subRouteUid === b.subRouteUid),
  );
  if (!target) return [];
  const observedAt = Date.parse(target.gpsTime);
  if (
    !Number.isFinite(observedAt) ||
    Date.now() - observedAt >= STALE_AFTER_MS ||
    observedAt > Date.now() + POLL_INTERVAL_MS
  )
    return [];
  // A slow positions request must not revive an expired planned arrival.
  const freshArrival = peekRouteDetailSnapshot(
    ref.routeName,
    ref.city,
    ref.subRouteUid,
    leg.planContext,
    lang,
  );
  if (!freshArrival) {
    if (!locked) return [];
    arrival.eta = null;
  }

  // Last guard: a vehicle already past the boarding stop cannot be the one the
  // user boards, whatever the feeds say. Without this, a stale or mislabelled
  // record shows "已過站" all down the stop list next to a countdown to that
  // same boarding stop — two claims that cannot both be true.
  if (!locked && hasPassedBoardingStop(ride.stops, target)) return [];

  // The plate and the ETA come from the same arrival record, so one bus's
  // plate never sits beside another bus's countdown.
  return [
    {
      ...target,
      routeName: leg.routeName,
      city: leg.tdxCity ?? "",
      isTarget: true,
      estimateTime: arrival.eta ?? undefined,
      etaStopName: locked ? leg.arrivalStop : leg.departureStop,
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
 * - A failed poll, or one that takes longer than {@link STALE_AFTER_MS}, clears
 *   the vehicle: a stale position or ETA is worse than none.
 * - Each refresh carries a generation; a superseded or cancelled one is ignored.
 */
export function useLiveBusPositions(options?: {
  enabled: boolean;
  sessionKey: string;
  vehicle?: BoardedVehicle | null;
}): void {
  useAppTranslation();
  const lang = getAppLanguage();
  const activeBusLeg = useMapStore((s) => s.activeBusLeg);
  const setLiveBusPositions = useMapStore((s) => s.setLiveBusPositions);

  // Exposes the freshest leg object to the polling loop without making the
  // loop restart on every re-render — only the key below does that.
  const legRef = useRef<BusLeg | null>(activeBusLeg?.leg ?? null);
  legRef.current = activeBusLeg?.leg ?? null;

  const enabled = options?.enabled ?? true;
  const sessionKey = options?.sessionKey ?? "";
  const vehicleKey = JSON.stringify(options?.vehicle);
  const vehicleRef = useRef(options?.vehicle);
  vehicleRef.current = options?.vehicle;
  const legKey = enabled ? (activeBusLeg?.key ?? null) : null;

  // `legKey` is the intended restart key: the loop reads the freshest leg from
  // `legRef`, so the effect must NOT also depend on the leg object reference.
  useEffect(() => {
    // Session and lock identity invalidate all old requests even on the same leg.
    void sessionKey;
    void vehicleKey;
    const leg = legRef.current;
    if (!legKey || !leg) {
      setLiveBusPositions([]);
      return;
    }

    setLiveBusPositions([]);
    let cancelled = false;
    let generation = 0;
    let controller: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let staleTimer: ReturnType<typeof setTimeout> | null = null;

    const armStale = (lifetimeMs: number = STALE_AFTER_MS) => {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(
        () => {
          if (!cancelled) setLiveBusPositions([]);
        },
        Math.max(0, Math.min(STALE_AFTER_MS, lifetimeMs)),
      );
    };

    const refresh = async () => {
      const current = legRef.current;
      if (!current) return;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      const mine = ++generation;
      const live = () => !cancelled && !signal.aborted && mine === generation;

      try {
        const buses = await fetchLeg(current, signal, vehicleRef.current, lang);
        if (!live()) return;
        setLiveBusPositions(buses);
        // Only a vehicle on screen needs an expiry.
        if (buses.length) {
          const ref = legRouteDetailRef(current);
          const snapshot = peekRouteDetailSnapshot(
            ref.routeName,
            ref.city,
            ref.subRouteUid,
            current.planContext,
            lang,
          );
          armStale(
            Math.min(
              buses[0]?.estimateTime != null && snapshot
                ? snapshot.expiresAt - Date.now()
                : STALE_AFTER_MS,
              Date.parse(buses[0].gpsTime) + STALE_AFTER_MS - Date.now(),
            ),
          );
        } else if (staleTimer) clearTimeout(staleTimer);
      } catch {
        // A failed poll must not leave the previous vehicle looking current.
        if (live()) setLiveBusPositions([]);
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
      const expectedGeneration = generation + 1;
      await refresh();
      if (!cancelled && expectedGeneration === generation) scheduleNext();
    }

    function onVisibility() {
      if (cancelled) return;
      if (document.hidden) {
        generation++;
        controller?.abort();
        if (timer) clearTimeout(timer);
        if (staleTimer) clearTimeout(staleTimer);
        setLiveBusPositions([]);
      } else void tick();
    }

    tick();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      controller?.abort();
      if (timer) clearTimeout(timer);
      if (staleTimer) clearTimeout(staleTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      setLiveBusPositions([]);
    };
  }, [legKey, setLiveBusPositions, sessionKey, vehicleKey, lang]);
}
