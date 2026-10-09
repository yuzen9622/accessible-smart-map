import { a11yPlacesToMarkers, googlePlacesToMarkers } from "@/lib/aiResults";
import { parseAiRoutePlan } from "./routeContract";
import type { UIAction } from "./uiAction";

export function mapToolToActions(
  toolName: string,
  result: unknown,
  _args?: unknown,
): UIAction[] {
  switch (toolName) {
    case "findA11yPlaces":
      return [{ type: "show-markers", markers: a11yPlacesToMarkers(result) }];

    case "findGooglePlaces":
      return [{ type: "show-markers", markers: googlePlacesToMarkers(result) }];

    case "plan_route":
    case "planAccessibleRoute":
      return [{ type: "show-route", plan: parseAiRoutePlan(result) }];

    default:
      return [];
  }
}
