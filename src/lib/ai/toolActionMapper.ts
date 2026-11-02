import { getAppLanguage } from "@/i18n/language";
import { a11yPlacesToMarkers, googlePlacesToMarkers } from "@/lib/aiResults";
import { withRouteNameLanguage } from "@/lib/route/sourceNames";
import { getToolResultGroup } from "@/lib/toolResultCards";
import { toolResultFailure } from "@/lib/voice/voiceTools";
import { A11yEnum, type AiResultMarker } from "@/types";
import {
  isRouteTool,
  parseAiIndoorRoutePlan,
  parseAiRoutePlan,
} from "./routeContract";
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
  // A refused plan is the assistant's to explain; only an accepted plan must
  // satisfy the route contract.
  if (
    isRouteTool(toolName)
      ? (result as { ok?: unknown } | null)?.ok === false
      : toolResultFailure({ type: "result", name: toolName, result })
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

    // Only the text assistant's results carry clientAction; voice already ran
    // these through the backend's ui.command.
    case "startNavigation": {
      const value = result as { clientAction?: unknown; routeId?: unknown };
      return value?.clientAction === "start-navigation"
        ? [
            {
              type: "start-navigation",
              ...(typeof value.routeId === "string"
                ? { routeId: value.routeId }
                : {}),
            },
          ]
        : [];
    }
    case "stopNavigation":
      return (result as { clientAction?: unknown })?.clientAction ===
        "stop-navigation"
        ? [{ type: "stop-navigation" }]
        : [];

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

    case "planIndoorRoute":
      return [
        { type: "show-indoor-route", plan: parseAiIndoorRoutePlan(result) },
      ];

    default:
      return [];
  }
}
