import type { PlaceBounds } from "@/types/place";

/** 地點範圍必須來自資料，不可由座標推算。 */
export function isValidPlaceBounds(value: unknown): value is PlaceBounds {
  if (!Array.isArray(value) || value.length !== 4) return false;
  const [west, south, east, north] = value;
  return (
    typeof west === "number" &&
    Number.isFinite(west) &&
    typeof south === "number" &&
    Number.isFinite(south) &&
    typeof east === "number" &&
    Number.isFinite(east) &&
    typeof north === "number" &&
    Number.isFinite(north) &&
    west >= -180 &&
    east <= 180 &&
    south >= -90 &&
    north <= 90 &&
    west < east &&
    south < north
  );
}
