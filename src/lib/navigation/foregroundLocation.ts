import type { LatLng } from "@/types";

/**
 * Foreground GPS refresh (WP4).
 *
 * Mobile browsers (and the Capacitor WKWebView) suspend `watchPosition`
 * while the app is backgrounded, so the fix the map still holds when the
 * user comes back can be minutes and several blocks old. Returning to the
 * foreground therefore has to ask for a brand-new fix explicitly —
 * `maximumAge: 0` so the platform cannot answer from that stale cache.
 *
 * Kept as a pure, dependency-injected function so the visibility/geolocation
 * wiring in `useNavigation` stays testable without a DOM.
 */

export const FOREGROUND_FIX_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10_000,
};

export interface ForegroundLocationDeps {
  /** Current document visibility; only "visible" triggers a refresh. */
  isVisible: () => boolean;
  geolocation: Pick<Geolocation, "getCurrentPosition"> | null | undefined;
  /** Receives the fresh fix plus its course-over-ground, when reported. */
  onPosition: (location: LatLng, heading: number | null) => void;
}

/**
 * Requests one fresh fix when the app is in the foreground.
 * Returns whether a request was actually issued (false = hidden tab, or no
 * geolocation available). Errors are swallowed: the existing watch keeps
 * running and already surfaces GPS failures to the user.
 */
export function requestForegroundLocationFix(
  deps: ForegroundLocationDeps,
): boolean {
  if (!deps.isVisible() || !deps.geolocation) return false;

  deps.geolocation.getCurrentPosition(
    (position) => {
      const heading = position.coords.heading;
      deps.onPosition(
        { lat: position.coords.latitude, lng: position.coords.longitude },
        typeof heading === "number" && !Number.isNaN(heading) ? heading : null,
      );
    },
    () => {},
    FOREGROUND_FIX_OPTIONS,
  );
  return true;
}
