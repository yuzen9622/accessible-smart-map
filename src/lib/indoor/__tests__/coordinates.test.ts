import { describe, expect, it } from "vitest";
import { lngLatToLocal, localToLngLat } from "../coordinates";

describe("whole-building map coordinates", () => {
  it("keeps the origin and independently preserves east and north", () => {
    const origin: [number, number] = [12, 35];
    expect(localToLngLat([0, 0], origin)).toEqual(origin);
    const east = localToLngLat([10, 0], origin);
    const north = localToLngLat([0, 10], origin);
    expect(east[0]).toBeGreaterThan(origin[0]);
    expect(east[1]).toBe(origin[1]);
    expect(north[0]).toBe(origin[0]);
    expect(north[1]).toBeGreaterThan(origin[1]);
  });

  it("round trips asymmetric footprints without skew, reflection or rescaling", () => {
    const origin: [number, number] = [-70, 40];
    const polygon: [number, number][] = [
      [-37, -20],
      [51, -20],
      [51, 42],
      [7, 42],
      [7, 18],
      [-37, 18],
    ];
    for (const point of polygon) {
      const actual = lngLatToLocal(localToLngLat(point, origin), origin);
      expect(actual[0]).toBeCloseTo(point[0], 7);
      expect(actual[1]).toBeCloseTo(point[1], 7);
    }
  });

  it("uses the exporter's 6371000 metre sphere for both axes", () => {
    const oneDegreeM = (6371000 * Math.PI) / 180;
    const result = lngLatToLocal([1, 1], [0, 0]);
    expect(result[0]).toBeCloseTo(oneDegreeM, 8);
    expect(result[1]).toBeCloseTo(oneDegreeM, 8);
    expect(lngLatToLocal([1, 60], [0, 60])[0]).toBeCloseTo(oneDegreeM / 2, 8);
  });
});
