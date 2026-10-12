import { getAppLanguage } from "@/i18n/language";
import { a11yPlacesToMarkers, googlePlacesToMarkers } from "@/lib/aiResults";
import { withRouteNameLanguage } from "@/lib/route/sourceNames";
import { parseAiRoutePlan } from "./routeContract";
import type { UIAction } from "./uiAction";

export function mapToolToActions(
  toolName: string,
  result: unknown,
  _args?: unknown,
  displayLanguage?: "en" | "zh-TW",
): UIAction[] {
  switch (toolName) {
    case "findA11yPlaces":
      return [
        {
          type: "show-markers",
          markers: a11yPlacesToMarkers(
            result,
            undefined,
            displayLanguage === undefined ||
              displayLanguage === getAppLanguage(),
          ),
        },
      ];

    case "findGooglePlaces":
      return [{ type: "show-markers", markers: googlePlacesToMarkers(result) }];

    case "plan_route":
    case "planAccessibleRoute": {
      const plan = parseAiRoutePlan(result);
      return [
        {
          type: "show-route",
          plan: {
            ...plan,
            routes: plan.routes.map((route) =>
              withRouteNameLanguage(route, displayLanguage),
            ),
          },
        },
      ];
    }

    default:
      return [];
  }
}
