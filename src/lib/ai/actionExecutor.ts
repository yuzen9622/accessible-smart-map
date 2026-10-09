import {
  extendBounds,
  fitRouteBounds,
  routeBoundsFromLegs,
} from "@/lib/mapCamera";
import useMapStore from "@/stores/useMapStore";
import type { ActionResult, UIAction } from "./uiAction";

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
      const { routes, origin, destination, selectedRouteId } = action.plan;
      const selected = routes.find(
        (route) => route.routeId === selectedRouteId,
      );
      if (!selected) return { ok: false, skipped: "missing selected route" };
      s.applyAiRoutePlan(action.plan);

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

    case "switch-panel":
      s.setSheetMode(action.sheet);
      return { ok: true };

    case "close-chat":
      s.setChatOpen(false);
      return { ok: true };

    default:
      return {
        ok: false,
        skipped: `unknown action: ${(action as { type?: string }).type ?? "unknown"}`,
      };
  }
}
