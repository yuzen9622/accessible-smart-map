import { haversineMeters } from "@/lib/geo";
import type { LatLng } from "@/types";
import type { AccessibleRoute } from "@/types/route";

/** The provider must reach the authored arrival; never draw an invented gap. */
export function routeReachesArrival(
  route: AccessibleRoute,
  arrival: LatLng,
): boolean {
  const last = route.legs.flatMap((leg) => leg.polyline ?? []).at(-1);
  return (
    !!last &&
    last.length >= 2 &&
    last.every(Number.isFinite) &&
    Number.isFinite(arrival.lat) &&
    Number.isFinite(arrival.lng) &&
    haversineMeters({ lng: last[0], lat: last[1] }, arrival) <= 2
  );
}

/** Bounded public-road snapping, not a fabricated connector from a POI centre. */
export function routeStartsAtOrigin(
  route: AccessibleRoute,
  origin: LatLng,
  maxGapM = 10,
): boolean {
  const first = route.legs.flatMap((leg) => leg.polyline ?? [])[0];
  return (
    !!first &&
    first.length >= 2 &&
    first.every(Number.isFinite) &&
    Number.isFinite(origin.lat) &&
    Number.isFinite(origin.lng) &&
    haversineMeters({ lng: first[0], lat: first[1] }, origin) <= maxGapM
  );
}
