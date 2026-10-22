import type { BusLanguage, RouteDetailDirection } from "@/lib/api/transit";
import { getBusRouteDetail } from "@/lib/api/transit";
import type {
  BusCandidateMetadata,
  BusLeg,
  BusPlanContext,
} from "@/types/route";

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
export interface RouteDetailSnapshot extends BusCandidateMetadata {
  directions: RouteDetailDirection[];
  receivedAt: number;
  expiresAt: number;
}

interface Entry {
  promise: Promise<RouteDetailSnapshot | null>;
  /** Last successful response, still readable while its replacement is pending. */
  snapshot?: RouteDetailSnapshot;
  settled: boolean;
}

const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

/** Keep summaries and expanded details on the same per-plan refresh. */
export function subscribeRouteDetail(
  key: string,
  listener: () => void,
): () => void {
  const group = listeners.get(key) ?? new Set<() => void>();
  group.add(listener);
  listeners.set(key, group);
  return () => {
    group.delete(listener);
    if (group.size === 0) listeners.delete(key);
  };
}

function notify(key: string) {
  for (const listener of listeners.get(key) ?? []) listener();
}

export function routeDetailKey(
  routeName: string,
  city: string,
  subRouteUid?: string,
  planContext?: BusPlanContext,
  lang?: BusLanguage,
): string {
  return JSON.stringify([
    lang ?? null,
    city,
    routeName,
    subRouteUid ?? null,
    planContext?.routeToken ?? null,
    planContext?.legIndex ?? null,
  ]);
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
  planContext?: BusPlanContext,
  lang?: BusLanguage,
): RouteDetailSnapshot | null {
  const entry = cache.get(
    routeDetailKey(routeName, city, subRouteUid, planContext, lang),
  );
  if (!entry?.snapshot) return null;
  if (Date.now() >= entry.snapshot.expiresAt) return null;
  return entry.snapshot;
}

/** The cached directions when a fresh entry exists, else null. Never fetches. */
export function peekRouteDetail(
  routeName: string,
  city: string,
  subRouteUid?: string,
  planContext?: BusPlanContext,
  lang?: BusLanguage,
): RouteDetailDirection[] | null {
  return (
    peekRouteDetailSnapshot(routeName, city, subRouteUid, planContext, lang)
      ?.directions ?? null
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
 * A failed refresh keeps its previous response only until the original expiry.
 * Without a fresh response it resolves to null and drops only its own entry.
 */
export function fetchRouteDetailSnapshot(
  routeName: string,
  city: string,
  opts?: {
    force?: boolean;
    subRouteUid?: string;
    signal?: AbortSignal;
    planContext?: BusPlanContext;
    lang?: BusLanguage;
  },
): Promise<RouteDetailSnapshot | null> {
  const subRouteUid = opts?.subRouteUid;
  const planContext = opts?.planContext;
  const lang = opts?.lang;
  const key = routeDetailKey(routeName, city, subRouteUid, planContext, lang);
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
    snapshot: existing?.snapshot,
    promise: Promise.resolve(null),
  };

  const failed = () => {
    entry.settled = true;
    if (cache.get(key) !== entry) return null;
    if (entry.snapshot && Date.now() < entry.snapshot.expiresAt)
      return entry.snapshot;
    cache.delete(key);
    notify(key);
    return null;
  };

  entry.promise = (async () => {
    try {
      const res = await getBusRouteDetail(
        routeName,
        city,
        subRouteUid,
        undefined,
        planContext,
        lang,
      );
      const directions = res.ok ? res.data?.directions : undefined;
      if (!directions) return failed();
      const receivedAt = Date.now();
      entry.snapshot = {
        directions,
        ...(res.data?.departureCandidates === undefined
          ? {}
          : { departureCandidates: res.data.departureCandidates }),
        ...(res.data?.candidateSearchComplete === undefined
          ? {}
          : { candidateSearchComplete: res.data.candidateSearchComplete }),
        receivedAt,
        expiresAt: receivedAt + TTL_MS,
      };
      entry.settled = true;
      // A superseded request must not publish into a newer plan snapshot.
      if (cache.get(key) === entry) notify(key);
      return entry.snapshot;
    } catch {
      return failed();
    }
  })();

  cache.set(key, entry);
  return untilAborted(entry.promise, opts?.signal);
}

export async function fetchRouteDetailCached(
  routeName: string,
  city: string,
  opts?: {
    force?: boolean;
    subRouteUid?: string;
    signal?: AbortSignal;
    planContext?: BusPlanContext;
    lang?: BusLanguage;
  },
): Promise<RouteDetailDirection[] | null> {
  return (
    (await fetchRouteDetailSnapshot(routeName, city, opts))?.directions ?? null
  );
}

/** Test-only escape hatch. */
export function __clearRouteDetailCache(): void {
  cache.clear();
}
