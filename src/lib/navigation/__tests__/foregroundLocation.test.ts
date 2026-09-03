import { describe, expect, it, vi } from "vitest";
import {
  FOREGROUND_FIX_OPTIONS,
  requestForegroundLocationFix,
} from "../foregroundLocation";

function fakeGeolocation(position?: Partial<GeolocationCoordinates>) {
  const getCurrentPosition = vi.fn(
    (onSuccess: PositionCallback, _onError, _options) => {
      if (!position) return;
      onSuccess({
        coords: {
          latitude: 25.0478,
          longitude: 121.517,
          accuracy: 5,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          ...position,
        },
        timestamp: 0,
      } as GeolocationPosition);
    },
  );
  return { getCurrentPosition };
}

describe("requestForegroundLocationFix", () => {
  it("asks for an uncached high-accuracy fix while visible", () => {
    const geolocation = fakeGeolocation();
    const requested = requestForegroundLocationFix({
      isVisible: () => true,
      geolocation,
      onPosition: vi.fn(),
    });

    expect(requested).toBe(true);
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geolocation.getCurrentPosition.mock.calls[0][2]).toEqual(
      FOREGROUND_FIX_OPTIONS,
    );
    // maximumAge: 0 is the whole point — the cached fix is the stale one.
    expect(FOREGROUND_FIX_OPTIONS.maximumAge).toBe(0);
  });

  it("does nothing while the document is hidden", () => {
    const geolocation = fakeGeolocation();
    const requested = requestForegroundLocationFix({
      isVisible: () => false,
      geolocation,
      onPosition: vi.fn(),
    });

    expect(requested).toBe(false);
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });

  it("does nothing when the platform exposes no geolocation", () => {
    expect(
      requestForegroundLocationFix({
        isVisible: () => true,
        geolocation: undefined,
        onPosition: vi.fn(),
      }),
    ).toBe(false);
  });

  it("publishes the fresh fix with its course-over-ground", () => {
    const onPosition = vi.fn();
    requestForegroundLocationFix({
      isVisible: () => true,
      geolocation: fakeGeolocation({ heading: 90 }),
      onPosition,
    });

    expect(onPosition).toHaveBeenCalledWith({ lat: 25.0478, lng: 121.517 }, 90);
  });

  it("reports a missing or NaN heading as null", () => {
    const onPosition = vi.fn();
    requestForegroundLocationFix({
      isVisible: () => true,
      geolocation: fakeGeolocation({ heading: Number.NaN }),
      onPosition,
    });

    expect(onPosition).toHaveBeenCalledWith(
      { lat: 25.0478, lng: 121.517 },
      null,
    );
  });
});
