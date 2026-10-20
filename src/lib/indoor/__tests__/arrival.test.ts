import { describe, expect, it } from "vitest";
import type { AccessibleRoute } from "@/types/route";
import { routeReachesArrival, routeStartsAtOrigin } from "../arrival";

function route(points: [number, number][]): AccessibleRoute {
  return {
    routeId: "synthetic-route",
    routeName: "Synthetic route",
    totalMinutes: 1,
    transferCount: 0,
    accessibilityHighlights: [],
    legs: [
      {
        type: "WALK",
        from: "Origin",
        to: "Arrival",
        distanceM: 100,
        minutesEst: 1,
        a11yFacilities: [],
        polyline: points,
      },
    ],
  };
}

describe("outdoor geometry endpoint continuity", () => {
  const origin = { lat: 0, lng: 0 };
  const arrival = { lat: 0, lng: 0.01 };
  const longitudeForMeters = (meters: number) =>
    ((meters / 6_371_000) * 180) / Math.PI;

  it.each([
    [0, true],
    [1.99, true],
    [6, true],
    [9.99, true],
    [10.01, false],
    [80, false],
  ])(
    "allows a bounded public-road start snap without changing geometry (%sm)",
    (distance, expected) => {
      const data = route([
        [longitudeForMeters(distance), 0],
        [arrival.lng, arrival.lat],
      ]);
      const before = structuredClone(data);
      expect(routeReachesArrival(data, arrival)).toBe(true);
      expect(routeStartsAtOrigin(data, origin)).toBe(expected);
      expect(data).toEqual(before);
    },
  );

  it("checks the first geometry point instead of finding the origin later on the path", () => {
    expect(
      routeStartsAtOrigin(
        route([
          [0.001, 0],
          [0, 0],
          [0.01, 0],
        ]),
        origin,
      ),
    ).toBe(false);
  });

  it("rejects absent or non-finite start geometry and invalid selected coordinates", () => {
    expect(routeStartsAtOrigin(route([]), origin)).toBe(false);
    expect(routeStartsAtOrigin(route([[Number.NaN, 0]]), origin)).toBe(false);
    expect(
      routeStartsAtOrigin(route([[0, 0]]), { lat: Number.NaN, lng: 0 }),
    ).toBe(false);
    expect(
      routeStartsAtOrigin(route([[0, 0]]), {
        lat: 0,
        lng: Number.POSITIVE_INFINITY,
      }),
    ).toBe(false);
  });
});
