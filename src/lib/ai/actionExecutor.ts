import i18n from "i18next";
import { toast } from "sonner";
import { getAppLanguage } from "@/i18n/language";
import { END_POINT } from "@/lib/config";
import { aiVenueJourney } from "@/lib/indoor/aiVenueLeg";
import { indoorModelVersion } from "@/lib/indoor/catalog";
import type { VenueJourney } from "@/lib/indoor/journey";
import { loadVenue } from "@/lib/indoor/venueApi";
import {
  extendBounds,
  fitRouteBounds,
  routeBoundsFromLegs,
} from "@/lib/mapCamera";
import { runNavigationControl } from "@/lib/voice/voiceNavigationControl";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";
import type { AccessibleRoute, AiRoutePlan, AiVenueLeg } from "@/types/route";
import { trackAiVenueLoad } from "./aiVenueLoad";
import type { ActionResult, UIAction } from "./uiAction";

/**
 * Load the venue a plan's indoor leg runs through and show the leg with the
 * routes already on the map. The outdoor routes (or the indoor route's token)
 * are registered synchronously before this runs, so a voice `nav.start` that
 * follows the tool result is never refused while the venue loads.
 */
export async function showAiVenueLeg(
  routes: AccessibleRoute[],
  leg: AiVenueLeg,
  plan?: AiRoutePlan,
): Promise<boolean> {
  const current = () => useMapStore.getState().computeRoutes === routes;
  try {
    const detail = await loadVenue(END_POINT, leg.route.venueId);
    if (!current()) return false;
    const { journey, models } = aiVenueJourney(
      detail,
      leg,
      END_POINT,
      getAppLanguage(),
    );
    const catalog = useIndoorCatalog.getState();
    if (
      !catalog.models.some(
        (model) =>
          model.venueId === journey.venueId &&
          indoorModelVersion(model) === journey.sourceVersion,
      )
    )
      catalog.setModels([
        ...catalog.models.filter((model) => model.venueId !== journey.venueId),
        ...models,
      ]);
    const full: VenueJourney =
      leg.direction === "arrival" && plan
        ? {
            ...journey,
            outdoor: {
              origin: {
                kind: "coordinate",
                address: plan.origin.name,
                position: plan.origin,
              },
              travelMode: plan.effectivePreferences.travelMode,
              approachRoutes: {},
              phase: "travel",
              routes,
              selectedIndex: Math.max(
                0,
                routes.findIndex(
                  (route) => route.routeId === plan.selectedRouteId,
                ),
              ),
              arrival: journey.from,
            },
          }
        : journey;
    return useMapStore.getState().attachAiVenueJourney(routes, full);
  } catch (error) {
    if (!current()) return false;
    console.warn("AI venue leg unavailable", error);
    toast.error(
      i18n.t("aiVenueLegUnavailable", {
        defaultValue: "室內路段暫時無法顯示在地圖上，語音導航不受影響。",
      }),
    );
    return false;
  }
}

export function executeAction(action: UIAction): ActionResult {
  const s = useMapStore.getState();

  switch (action.type) {
    case "show-markers":
      s.setAiResultMarkers(action.markers);
      return { ok: true };

    case "clear-markers":
      s.setAiResultMarkers([]);
      return { ok: true };

    case "fly-to":
      s.map?.flyTo({
        center: [action.position.lng, action.position.lat],
        zoom: action.zoom ?? 17,
      });
      return { ok: true };

    case "show-route": {
      const { routes, origin, destination, selectedRouteId, venue } =
        action.plan;
      const selected = routes.find(
        (route) => route.routeId === selectedRouteId,
      );
      if (!selected) return { ok: false, skipped: "missing selected route" };
      s.applyAiRoutePlan(action.plan);
      const applied = useMapStore.getState().computeRoutes;
      trackAiVenueLoad(
        venue && applied
          ? showAiVenueLeg(applied, venue, action.plan)
          : Promise.resolve(true),
      );

      if (s.map) {
        const bounds = routeBoundsFromLegs(selected.legs);
        if (bounds.isEmpty() && origin && destination) {
          extendBounds(bounds, origin.lng, origin.lat);
          extendBounds(bounds, destination.lng, destination.lat);
        }
        fitRouteBounds(s.map, bounds);
      }
      return { ok: true };
    }

    case "show-indoor-route": {
      s.applyAiIndoorRoutePlan(action.plan);
      const applied = useMapStore.getState().computeRoutes;
      trackAiVenueLoad(
        applied
          ? showAiVenueLeg(applied, action.plan.venue)
          : Promise.resolve(false),
      );
      return { ok: true };
    }

    case "switch-panel":
      s.setSheetMode(action.sheet);
      return { ok: true };

    case "close-chat":
      s.setChatOpen(false);
      return { ok: true };

    case "start-navigation":
    case "stop-navigation": {
      // Settles after the page's own start flow; the chat closes once it runs.
      const settled = runNavigationControl(
        action.type === "start-navigation"
          ? {
              action: "start",
              ...(action.routeId ? { routeId: action.routeId } : {}),
            }
          : { action: "stop" },
      ).then((result) => {
        if (result.ok && action.type === "start-navigation")
          useMapStore.getState().setChatOpen(false);
      });
      return { ok: true, settled };
    }

    default:
      return {
        ok: false,
        skipped: `unknown action: ${(action as { type?: string }).type ?? "unknown"}`,
      };
  }
}
