import { getAppLanguage } from "@/i18n/language";
import { a11yPlacesToMarkers, googlePlacesToMarkers } from "@/lib/aiResults";
import { withRouteNameLanguage } from "@/lib/route/sourceNames";
import { getToolResultGroup } from "@/lib/toolResultCards";
import { toolResultFailure } from "@/lib/voice/voiceTools";
import { A11yEnum, type AiResultMarker } from "@/types";
import { parseAiRoutePlan } from "./routeContract";
import type { UIAction } from "./uiAction";

function markerActions(markers: AiResultMarker[]): UIAction[] {
  const valid = markers.filter(
    ({ position: { lat, lng } }) =>
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180,
  );
  return valid.length ? [{ type: "show-markers", markers: valid }] : [];
}

export function mapToolToActions(
  toolName: string,
  result: unknown,
  _args?: unknown,
  displayLanguage?: "en" | "zh-TW",
): UIAction[] {
  if (
    toolName !== "plan_route" &&
    toolName !== "planAccessibleRoute" &&
    toolResultFailure({ type: "result", name: toolName, result })
  )
    return [];
  switch (toolName) {
    case "findA11yPlaces":
      return markerActions(
        a11yPlacesToMarkers(
          result,
          undefined,
          displayLanguage === undefined || displayLanguage === getAppLanguage(),
        ),
      );

    case "findGooglePlaces":
      return markerActions(googlePlacesToMarkers(result));

    case "findNearbyParking":
    case "findNearbyBusStops":
    case "findCampusAccessibility":
    case "getCampusAccessibilityDetails":
    case "getA11yFacilityDetails":
    case "trackBuses":
    case "getNearbyHazards": {
      const group = getToolResultGroup(
        toolName,
        result,
        undefined,
        displayLanguage,
      );
      return markerActions(
        (group?.items ?? []).flatMap((item): AiResultMarker[] => {
          if (!item.position) return [];
          const marker = {
            id: item.id,
            position: item.position,
            content: { title: item.title, desc: item.subtitle ?? "" },
            type: "pin" as const,
            zIndex: 1,
            a11yType: A11yEnum.NONE,
          };
          return [
            {
              ...item,
              position: item.position,
              desc: item.subtitle,
              target: item.target ?? { panel: "station", marker },
            },
          ];
        }),
      );
    }

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
