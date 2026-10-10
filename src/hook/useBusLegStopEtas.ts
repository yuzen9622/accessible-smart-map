import { useEffect, useRef, useState } from "react";
import type { RouteDetailDirection } from "@/lib/api/transit";
import {
  fetchRouteDetailSnapshot,
  peekRouteDetailSnapshot,
  routeDetailKey,
} from "@/lib/transit/busRouteDetailCache";
import type { BusLeg, BusPlanContext } from "@/types/route";

export type BusLegEtaStatus = "idle" | "loading" | "ready" | "error";

// Shorter than the route-detail cache TTL (15s): a polling consumer replaces
// its data before it expires instead of blanking the list between ticks.
const POLL_INTERVAL_MS = 10_000;

interface EtaState {
  /** Branch identity the data belongs to; data under another key is never shown. */
  key: string;
  directions: RouteDetailDirection[] | null;
  expiresAt: number;
  status: BusLegEtaStatus;
}

const emptyState = (key: string, status: BusLegEtaStatus): EtaState => ({
  key,
  directions: null,
  expiresAt: 0,
  status,
});

function seed(
  routeName: string,
  city: string,
  uid?: string,
  planContext?: BusPlanContext,
): EtaState {
  const key = routeDetailKey(routeName, city, uid, planContext);
  const warm =
    routeName && city
      ? peekRouteDetailSnapshot(routeName, city, uid, planContext)
      : null;
  return warm
    ? {
        key,
        directions: warm.directions,
        expiresAt: warm.expiresAt,
        status: "ready",
      }
    : emptyState(key, "idle");
}

/**
 * Stop-by-stop ETAs for one BUS leg.
 *
 * `enabled` and `poll` are deliberately separate: selecting a route enables the
 * hook so the payload is already warm (and shared through the route-detail
 * cache) by the time the user expands the leg, while only expanding it starts
 * the refresh. Fetching only on expand is what made every stop render as
 * 「尚未發車」 for the first second.
 *
 * The backend returns only this planned ride and decides which stop ETAs
 * belong to its trip; a missing match retains the original scheduled times.
 *
 * Data is bound to its branch key and to the cache's receipt time: switching
 * leg or branch never exposes the previous one, and ETAs vanish once they are
 * older than the cache TTL instead of being shown indefinitely.
 */
export function useBusLegStopEtas(
  leg: BusLeg | null,
  enabled: boolean,
  poll: boolean,
): { directions: RouteDetailDirection[] | null; status: BusLegEtaStatus } {
  const city = leg?.tdxCity ?? leg?.cityCode ?? "";
  // TDX indexes stop sequences by sub-route: 99 and 99延 are different lists.
  // The planner names the run it chose, so ask for that one.
  const routeName = leg?.subRouteName ?? leg?.routeName ?? "";
  const subRouteUid = leg?.subRouteUid;
  const planContext = leg?.planContext;
  const routeToken = planContext?.routeToken;
  const legIndex = planContext?.legIndex;
  const key = routeDetailKey(routeName, city, subRouteUid, planContext);

  // Seed from an already-warm cache entry so the first render after expanding
  // shows real ETAs instead of a placeholder.
  const [state, setState] = useState<EtaState>(() =>
    seed(routeName, city, subRouteUid, planContext),
  );

  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    if (
      !enabled ||
      !routeName ||
      !city ||
      !routeToken ||
      legIndex === undefined
    ) {
      setState(emptyState(key, "idle"));
      return;
    }

    let cancelled = false;
    let version = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const fetchEtas = async (force: boolean) => {
      const mine = ++version;
      const snapshot = await fetchRouteDetailSnapshot(routeName, city, {
        force,
        subRouteUid,
        planContext: { routeToken, legIndex },
        signal: controller.signal,
      });
      // Superseded or cancelled: a late response must not overwrite newer state.
      if (cancelled || mine !== version) return;

      if (!snapshot) {
        setState(emptyState(key, "error"));
        return;
      }
      setState({
        key,
        directions: snapshot.directions,
        expiresAt: snapshot.expiresAt,
        status: "ready",
      });
    };

    function scheduleNext() {
      if (timer) clearTimeout(timer);
      // Force, or the poll would be served from the route-detail cache and only
      // ever refresh because the TTL happens to be shorter than the interval.
      timer = setTimeout(() => tick(true), POLL_INTERVAL_MS);
    }

    async function tick(force = false) {
      if (typeof document !== "undefined" && document.hidden) {
        scheduleNext();
        return;
      }
      await fetchEtas(force);
      if (!cancelled) scheduleNext();
    }

    function onVisibility() {
      if (!cancelled && !document.hidden) tick(true);
    }

    // A warm cache entry means we already have data; don't flash a loading
    // state over it just because the effect re-ran. A cold one (or one from a
    // different branch) must clear whatever was showing.
    const warm = peekRouteDetailSnapshot(routeName, city, subRouteUid, {
      routeToken,
      legIndex,
    });
    setState(
      warm
        ? {
            key,
            directions: warm.directions,
            expiresAt: warm.expiresAt,
            status: "ready",
          }
        : emptyState(key, "loading"),
    );

    if (poll) {
      tick();
      document.addEventListener("visibilitychange", onVisibility);
    } else {
      // Prefetch only: warm the shared cache once, no timer, no listener.
      void fetchEtas(false);
    }

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, poll, routeName, city, subRouteUid, key, routeToken, legIndex]);

  // Expire what is on screen at the cache's deadline. The receipt time is not
  // renewed by this: only a new response can bring data back.
  const { key: stateKey, expiresAt } = state;
  useEffect(() => {
    if (!expiresAt) return;
    const wait = Math.max(0, expiresAt - Date.now());
    const timer = setTimeout(() => {
      setState((current) =>
        current.key === stateKey && current.expiresAt === expiresAt
          ? emptyState(stateKey, pollRef.current ? "loading" : "idle")
          : current,
      );
    }, wait);
    return () => clearTimeout(timer);
  }, [stateKey, expiresAt]);

  if (!enabled || !routeToken || legIndex === undefined)
    return { directions: null, status: "idle" };

  // Render guard: nothing from another branch, nothing past its deadline.
  if (state.key !== key) {
    return { directions: null, status: enabled ? "loading" : "idle" };
  }
  if (state.directions && Date.now() >= state.expiresAt) {
    return { directions: null, status: poll ? "loading" : "idle" };
  }
  return { directions: state.directions, status: state.status };
}
