import type { RouteDetailDirection } from "@/lib/api/transit";
import { getBusRouteDetail } from "@/lib/api/transit";

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
 */

const TTL_MS = 15_000;

interface Entry {
  at: number;
  promise: Promise<RouteDetailDirection[] | null>;
  /** Set once the promise resolves, so `peekRouteDetail` can read it. */
  value?: RouteDetailDirection[] | null;
  settled: boolean;
}

const cache = new Map<string, Entry>();

export function routeDetailKey(routeName: string, city: string): string {
  return `${city}::${routeName}`;
}

/** The cached directions when a fresh entry exists, else null. Never fetches. */
export function peekRouteDetail(
  routeName: string,
  city: string,
): RouteDetailDirection[] | null {
  const entry = cache.get(routeDetailKey(routeName, city));
  if (!entry?.settled) return null;
  if (Date.now() - entry.at > TTL_MS) return null;
  return entry.value ?? null;
}

/**
 * Fetch the route's stop list + ETAs, deduplicated.
 *
 * Within {@link TTL_MS} the cached promise is returned as-is. `force` (used by
 * the poll loop) bypasses the age check but still joins an in-flight request,
 * so N legs of the same line never issue N requests.
 *
 * Never rejects: a failed lookup resolves to null *and* drops the entry, so a
 * transient error is retried on the next call instead of being cached.
 */
export function fetchRouteDetailCached(
  routeName: string,
  city: string,
  opts?: { force?: boolean },
): Promise<RouteDetailDirection[] | null> {
  const key = routeDetailKey(routeName, city);
  const existing = cache.get(key);

  if (existing) {
    const fresh = Date.now() - existing.at <= TTL_MS;
    // An in-flight request is always joined, even when forcing.
    if (!existing.settled || (fresh && !opts?.force)) return existing.promise;
  }

  const entry: Entry = {
    at: Date.now(),
    settled: false,
    promise: Promise.resolve(null),
  };

  entry.promise = (async () => {
    try {
      const res = await getBusRouteDetail(routeName, city);
      const directions = res.ok ? res.data?.directions : undefined;
      if (!directions) {
        cache.delete(key);
        return null;
      }
      entry.value = directions;
      entry.settled = true;
      entry.at = Date.now();
      return directions;
    } catch {
      cache.delete(key);
      return null;
    }
  })();

  cache.set(key, entry);
  return entry.promise;
}

/** Test-only escape hatch. */
export function __clearRouteDetailCache(): void {
  cache.clear();
}
