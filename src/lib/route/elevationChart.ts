import type {
  AvailableElevationProfile,
  ElevationSample,
} from "@/types/elevation";

export const ELEVATION_PLOT = { width: 320, height: 128, inset: 4 };

type PlotPoint = { x: number; y: number; index: number };

export function buildElevationChart(profile: AvailableElevationProfile) {
  if (
    !Number.isFinite(profile.distanceM) ||
    profile.distanceM <= 0 ||
    !Array.isArray(profile.samples) ||
    !profile.samples.length ||
    !profile.summary
  )
    return null;

  let previousDistance = -1;
  const elevations: number[] = [];
  for (const sample of profile.samples) {
    if (
      !sample ||
      !Number.isFinite(sample.distanceM) ||
      sample.distanceM < 0 ||
      sample.distanceM < previousDistance ||
      sample.distanceM > profile.distanceM ||
      !Array.isArray(sample.coordinates) ||
      sample.coordinates.length !== 2 ||
      !sample.coordinates.every(Number.isFinite) ||
      Math.abs(sample.coordinates[0]) > 180 ||
      Math.abs(sample.coordinates[1]) > 90 ||
      (sample.elevationM !== null && !Number.isFinite(sample.elevationM))
    )
      return null;
    previousDistance = sample.distanceM;
    if (sample.elevationM !== null) elevations.push(sample.elevationM);
  }
  if (!elevations.length) return null;

  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const span = Math.max(20, max - min);
  const magnitude = 10 ** Math.floor(Math.log10(span / 2));
  const step =
    ([1, 2, 5, 10].find((value) => value * magnitude >= span / 2) ?? 10) *
    magnitude;
  const padding = (span - (max - min)) / 2;
  const lower = Math.floor((min - padding) / step) * step;
  const upper = Math.max(
    lower + step * 2,
    Math.ceil((max + padding) / step) * step,
  );
  const { width, height, inset } = ELEVATION_PLOT;
  const x = (distanceM: number) =>
    inset + (distanceM / profile.distanceM) * (width - inset * 2);
  const y = (elevationM: number) =>
    inset + ((upper - elevationM) / (upper - lower)) * (height - inset * 2);
  const segments: PlotPoint[][] = [];
  let segment: PlotPoint[] = [];
  profile.samples.forEach((sample, index) => {
    if (sample.elevationM === null) {
      if (segment.length) segments.push(segment);
      segment = [];
    } else {
      segment.push({ x: x(sample.distanceM), y: y(sample.elevationM), index });
    }
  });
  if (segment.length) segments.push(segment);

  return {
    lower,
    upper,
    x,
    y,
    ticks: [upper, (upper + lower) / 2, lower],
    segments: segments.map((points) => ({
      points,
      line: points
        .map(
          (point, i) =>
            `${i ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`,
        )
        .join(" "),
    })),
  };
}

export function nearestElevationSample(
  samples: ElevationSample[],
  distanceM: number,
) {
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (samples[mid].distanceM < distanceM) low = mid + 1;
    else high = mid;
  }
  return low > 0 &&
    distanceM - samples[low - 1].distanceM <= samples[low].distanceM - distanceM
    ? low - 1
    : low;
}
