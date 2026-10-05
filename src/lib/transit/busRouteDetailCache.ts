import type { RouteDetailDirection } from "@/lib/api/transit";
import { getBusRouteDetail } from "@/lib/api/transit";
import type { BusLeg } from "@/types/route";

/**
 * Process-wide cache for `/transit/bus/route-detail`.
 *
 * Two callers want the same payload at almost the same moment: selecting a
 * route prefetches every BUS leg's stop ETAs, and expanding one of those legs
 * then polls it. Without a shared cache the expand would refetch from scratch
 * and render placeholder rows again — the very flash this cache exists to kill.
 *
 * `peekRouteDetail` is the synchronous half: a hook can seed its initial state
 * from an already-warm entry so the first render after expanding is real data,
 * not a loading state.
 *
 * Freshness is measured from the moment the response was *received*, once.
 * Reading an entry never refreshes it, so a consumer can tell exactly when the
 * ETAs it renders stop being trustworthy ({@link RouteDetailSnapshot.expiresAt}).
 */

const TTL_MS = 15_000;

/** What a consumer needs to render ETAs and to know when to stop. */
export interface RouteDetailSnapshot {
  directions: RouteDetailDirection[];
  receivedAt: number;
  expiresAt: number;
}

interface Entry {
  promise: Promise<RouteDetailSnapshot | null>;
  /** Set once the response arrives, so `peekRouteDetail` can read it. */
  snapshot?: RouteDetailSnapshot;
  settled: boolean;
}

const cache = new Map<string, Entry>();

export function routeDetailKey(
  routeName: string,
  city: string,
  subRouteUid?: string,
): string {
  return JSON.stringify([city, routeName, subRouteUid ?? null]);
}

/** The route-detail identity of a leg — shared by every consumer of the cache. */
export function legRouteDetailRef(leg: BusLeg): {
  routeName: string;
  city: string;
  subRouteUid?: string;
} {
  return {
    routeName: leg.subRouteName ?? leg.routeName,
    city: leg.tdxCity ?? leg.cityCode ?? "",
    subRouteUid: leg.subRouteUid,
  };
}

/** The cached snapshot when a fresh entry exists, else null. Never fetches. */
export function peekRouteDetailSnapshot(
  routeName: string,
  city: string,
  subRouteUid?: string,
): RouteDetailSnapshot | null {
  const entry = cache.get(routeDetailKey(routeName, city, subRouteUid));
  if (!entry?.settled || !entry.snapshot) return null;
  if (Date.now() >= entry.snapshot.expiresAt) return null;
  return entry.snapshot;
}

/** The cached directions when a fresh entry exists, else null. Never fetches. */
export function peekRouteDetail(
  routeName: string,
  city: string,
  subRouteUid?: string,
): RouteDetailDirection[] | null {
  return (
    peekRouteDetailSnapshot(routeName, city, subRouteUid)?.directions ?? null
  );
}

/** Resolve with null as soon as `signal` aborts, without cancelling the shared request. */
function untilAborted<T>(
  promise: Promise<T | null>,
  signal?: AbortSignal,
): Promise<T | null> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    const onAbort = () => resolve(null);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => {
      signal.removeEventListener("abort", onAbort);
      resolve(signal.aborted ? null : value);
    });
  });
}

/**
 * Fetch the route's stop list + ETAs, deduplicated, with receipt times.
 *
 * Within {@link TTL_MS} of receipt the cached promise is returned as-is.
 * `force` (used by the poll loop) bypasses the age check but still joins an
 * in-flight request, so N legs of the same line never issue N requests.
 *
 * The shared request is never cancelled by one consumer: `signal` only stops
 * *this* caller from waiting (it resolves null), because another leg may still
 * need the same response.
 *
 * Never rejects: a failed lookup resolves to null *and* drops its own entry
 * (never a newer one), so a transient error is retried on the next call.
 */
export function fetchRouteDetailSnapshot(
  routeName: string,
  city: string,
  opts?: { force?: boolean; subRouteUid?: string; signal?: AbortSignal },
): Promise<RouteDetailSnapshot | null> {
  const subRouteUid = opts?.subRouteUid;
  const key = routeDetailKey(routeName, city, subRouteUid);
  const existing = cache.get(key);

  if (existing) {
    const fresh =
      existing.snapshot !== undefined &&
      Date.now() < existing.snapshot.expiresAt;
    // An in-flight request is always joined, even when forcing.
    if (!existing.settled || (fresh && !opts?.force))
      return untilAborted(existing.promise, opts?.signal);
  }

  const entry: Entry = {
    settled: false,
    promise: Promise.resolve(null),
  };

  const drop = () => {
    if (cache.get(key) === entry) cache.delete(key);
  };

  entry.promise = (async () => {
    try {
      const res = await getBusRouteDetail(routeName, city, subRouteUid);
      const directions = res.ok ? res.data?.directions : undefined;
      if (!directions) {
        drop();
        return null;
      }
      const receivedAt = Date.now();
      entry.snapshot = {
        directions,
        receivedAt,
        expiresAt: receivedAt + TTL_MS,
      };
      entry.settled = true;
      return entry.snapshot;
    } catch {
      drop();
      return null;
    }
  })();

  cache.set(key, entry);
  return untilAborted(entry.promise, opts?.signal);
}

export async function fetchRouteDetailCached(
  routeName: string,
  city: string,
  opts?: { force?: boolean; subRouteUid?: string; signal?: AbortSignal },
): Promise<RouteDetailDirection[] | null> {
  return (
    (await fetchRouteDetailSnapshot(routeName, city, opts))?.directions ?? null
  );
}

/** Test-only escape hatch. */
export function __clearRouteDetailCache(): void {
  cache.clear();
}
