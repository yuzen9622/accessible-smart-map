import { AI_ROUTE_UNAVAILABLE, parseAiRoutePlan } from "@/lib/ai/routeContract";
import type { RoutePreviewPageData } from "@/types/line";

export function parseSosRoutePreview(value: unknown): RoutePreviewPageData {
  if (!value || typeof value !== "object")
    throw new Error(AI_ROUTE_UNAVAILABLE);
  const preview = value as RoutePreviewPageData;
  if (
    typeof preview.sessionId !== "string" ||
    typeof preview.originLabel !== "string" ||
    typeof preview.destinationLabel !== "string"
  )
    throw new Error(AI_ROUTE_UNAVAILABLE);

  // SOS has no AI plan identity or preferences. Use the shared validator for
  // points/complete routes only; never apply this validation envelope to the store.
  const validated = parseAiRoutePlan({
    ok: true,
    routeContractVersion: 1,
    planId: preview.sessionId,
    selectedRouteId: preview.routes?.[0]?.routeId,
    origin: { ...preview.origin, name: preview.originLabel },
    destination: { ...preview.destination, name: preview.destinationLabel },
    routes: preview.routes,
    effectivePreferences: {
      mode: "normal",
      travelMode: "transit",
      transitPreference: "none",
      maxTransfers: 0,
      avoidStairs: false,
      requireElevator: false,
    },
  });
  return { ...preview, routes: validated.routes };
}
