import type { metroA11yData } from "@/types";

export type NearbyFacilityCategory = "toilet" | "elevator" | "ramp" | "other";

/** Preserve the source classification; only raw metro entries use its name rule. */
export function nearbyFacilityCategory(
  facility: metroA11yData,
): NearbyFacilityCategory {
  const code = facility.facType?.trim() || facility.category?.trim();
  switch (code) {
    case "accessible_toilet":
    case "toilet":
      return "toilet";
    case "elevator":
      return "elevator";
    case "ramp":
      return "ramp";
    default:
      break;
  }

  // Campus labels may contain a name that conflicts with its actual facType.
  // Do not infer a category from the name when a type code was provided.
  if (!code && facility.source === "metro") {
    const name = facility["出入口電梯/無障礙坡道名稱"];
    if (typeof name === "string" && name.includes("電梯")) return "elevator";
    if (typeof name === "string" && name.includes("坡道")) return "ramp";
  }
  return "other";
}
