import { describe, expect, it } from "vitest";
import type { AvailableElevationProfile } from "@/types/elevation";
import {
  buildElevationChart,
  ELEVATION_PLOT,
  nearestElevationSample,
} from "../elevationChart";

function profile(values: (number | null)[]): AvailableElevationProfile {
  const valid = values.filter((value): value is number => value !== null);
  return {
    status: valid.length === values.length ? "complete" : "partial",
    source: {
      dataset: "MOI_DTM_20M",
      kind: "terrain",
      resolutionM: 20,
      samplingIntervalM: 20,
      interpolation: "bilinear",
      smoothing: "none",
    },
    distanceM: (values.length - 1) * 20,
    samples: values.map((elevationM, i) => ({
      distanceM: i * 20,
      coordinates: [121.5 + i * 0.0002, 25],
      elevationM,
    })),
    summary: {
      ascentM: null,
      descentM: null,
      minElevationM: Math.min(...valid),
      maxElevationM: Math.max(...valid),
      netElevationM: null,
      validSamples: valid.length,
      sampleCount: values.length,
    },
  };
}

describe("elevation plot geometry", () => {
  it("uses route distance, not array position, and keeps the last short interval", () => {
    const input = profile([10, 20, 15]);
    input.distanceM = 25;
    input.samples[2].distanceM = 25;
    const chart = buildElevationChart(input);
    expect(chart).not.toBeNull();
    if (!chart) throw new Error("Expected a drawable profile");
    const [first, middle, last] = chart.segments[0].points;
    expect(first.x).toBe(ELEVATION_PLOT.inset);
    expect((middle.x - first.x) / (last.x - first.x)).toBeCloseTo(0.8);
    expect(last.x).toBe(ELEVATION_PLOT.width - ELEVATION_PLOT.inset);
    expect(middle.y).toBeLessThan(first.y);
  });

  it("does not connect gaps, including missing endpoints and isolated samples", () => {
    const chart = buildElevationChart(profile([null, 10, null, 15, 20, null]));
    expect(chart).not.toBeNull();
    if (!chart) throw new Error("Expected a partial profile");
    expect(
      chart.segments.map((segment) =>
        segment.points.map((point) => point.index),
      ),
    ).toEqual([[1], [3, 4]]);
    expect(chart.segments[0].line).not.toContain("L");
  });

  it.each([
    [7, 9],
    [1007, 1009],
    [-8, -7],
    [0, 0],
  ])("keeps a minimum readable vertical span for %j", (a, b) => {
    const chart = buildElevationChart(profile([a, b]));
    expect(chart).not.toBeNull();
    if (!chart) throw new Error("Expected a flat profile");
    expect(chart.upper - chart.lower).toBeGreaterThanOrEqual(20);
    expect(chart.lower).toBeLessThanOrEqual(Math.min(a, b));
    expect(chart.upper).toBeGreaterThanOrEqual(Math.max(a, b));
    if (a > 1000) expect(chart.lower).toBeGreaterThan(900);
    expect(chart.segments[0].line).not.toMatch(/NaN|Infinity/);
  });

  it("allows below-sea-level data without clamping to zero", () => {
    const chart = buildElevationChart(profile([-30, -10, 5]));
    expect(chart).not.toBeNull();
    if (!chart) throw new Error("Expected negative elevations to be valid");
    expect(chart.lower).toBeLessThanOrEqual(-30);
    expect(chart.segments[0].points[0].y).toBeGreaterThan(
      chart.segments[0].points[1].y,
    );
  });

  it.each(
    [[], [null, null], [10], [10, Number.NaN]].map((values) => ({ values })),
  )("returns no chart for unusable samples $values", ({ values }) => {
    expect(buildElevationChart(profile(values))).toBeNull();
  });

  it("rejects reversed distance and invalid coordinates rather than drawing a misleading curve", () => {
    const input = profile([10, 20, 15]);
    input.samples[2].distanceM = 10;
    expect(buildElevationChart(input)).toBeNull();
    input.samples[2].distanceM = 40;
    input.samples[2].coordinates = [25, 121.5];
    expect(buildElevationChart(input)).toBeNull();
  });

  it("selects the nearest distance including a missing sample, without jumping over a gap", () => {
    const { samples } = profile([10, null, 15]);
    expect(nearestElevationSample(samples, -1)).toBe(0);
    expect(nearestElevationSample(samples, 19)).toBe(1);
    expect(nearestElevationSample(samples, 40)).toBe(2);
    expect(nearestElevationSample(samples, 100)).toBe(2);
  });
});
