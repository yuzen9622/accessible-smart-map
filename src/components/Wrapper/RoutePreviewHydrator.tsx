"use client";

import { LngLatBounds } from "maplibre-gl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { AI_ROUTE_UNAVAILABLE, parseAiRoutePlan } from "@/lib/ai/routeContract";
import { getLineRoutePreview } from "@/lib/api/line";
import { extendBounds, fitRouteBounds } from "@/lib/mapCamera";
import { parseSosRoutePreview } from "@/lib/routePreviewAdapter";
import useMapStore from "@/stores/useMapStore";
import type { RoutePreviewQuery } from "@/types/line";
import type { AccessibleRoute } from "@/types/route";

function parseQuery(search: string): RoutePreviewQuery | null {
  const params = new URLSearchParams(search);
  const state = params.get("liff.state");
  const nested = new URLSearchParams(
    state?.includes("?") ? state.slice(state.indexOf("?") + 1) : (state ?? ""),
  );
  const entries = [params, nested].flatMap((source) =>
    ["planToken", "sessionId"].flatMap((key) =>
      source.getAll(key).map((value) => [key, value] as const),
    ),
  );
  if (entries.length === 0) return null;
  if (entries.length !== 1) throw new Error(AI_ROUTE_UNAVAILABLE);
  const [key, value] = entries[0];
  if (key === "planToken" && /^[A-Za-z0-9_-]{43}$/.test(value))
    return { planToken: value };
  if (key === "sessionId" && /^[a-f0-9]{32}$/i.test(value))
    return { sessionId: value };
  throw new Error(AI_ROUTE_UNAVAILABLE);
}

type CameraPreview = {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  route: AccessibleRoute;
  generation: number;
  search: string;
};

export default function RoutePreviewHydrator() {
  const search = useSearchParams().toString();
  const { map, routeGeneration, isNavigating } = useMapStore(
    useShallow((s) => ({
      map: s.map,
      routeGeneration: s.routeGeneration,
      isNavigating: s.isNavigating,
    })),
  );
  const [camera, setCamera] = useState<CameraPreview | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCamera(null);
    const state = useMapStore.getState();
    const generation = state.routeGeneration;
    const isCurrent = () =>
      !cancelled &&
      useMapStore.getState().routeGeneration === generation &&
      !useMapStore.getState().isNavigating;

    const hydrate = async () => {
      try {
        const query = parseQuery(search);
        if (!query) return;
        if (state.isNavigating) throw new Error(AI_ROUTE_UNAVAILABLE);
        const response = await getLineRoutePreview(query);
        if (!isCurrent()) return;
        if (!response.ok) throw new Error(AI_ROUTE_UNAVAILABLE);

        let preview: Omit<CameraPreview, "generation" | "search">;
        if ("planToken" in query) {
          const plan = parseAiRoutePlan(response.data);
          const selected = plan.routes.find(
            (route) => route.routeId === plan.selectedRouteId,
          );
          if (!selected) throw new Error(AI_ROUTE_UNAVAILABLE);
          state.applyAiRoutePlan(plan);
          preview = {
            origin: plan.origin,
            destination: plan.destination,
            route: selected,
          };
        } else {
          const sos = parseSosRoutePreview(response.data);
          const selected = sos.routes[0];
          state.setComputeRoutes(sos.routes);
          state.setRouteSelect({ index: 0, route: selected });
          state.setOrigin({
            kind: "coordinate",
            address: sos.originLabel,
            position: sos.origin,
          });
          state.setDestination({
            kind: "coordinate",
            address: sos.destinationLabel,
            position: sos.destination,
          });
          state.setOriginName(sos.originLabel);
          state.setDestinationName(sos.destinationLabel);
          state.setRouteInfoShow(true);
          state.setSheetMode("route");
          state.setRouteSubPanel("none");
          preview = {
            origin: sos.origin,
            destination: sos.destination,
            route: selected,
          };
        }
        setCamera({
          ...preview,
          search,
          generation: useMapStore.getState().routeGeneration,
        });
      } catch {
        if (!cancelled && useMapStore.getState().routeGeneration === generation)
          toast.error(AI_ROUTE_UNAVAILABLE);
      }
    };
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [search]);

  useEffect(() => {
    if (
      !map ||
      !camera ||
      camera.search !== search ||
      camera.generation !== routeGeneration ||
      isNavigating
    )
      return;
    const bounds = new LngLatBounds();
    extendBounds(bounds, camera.origin.lng, camera.origin.lat);
    extendBounds(bounds, camera.destination.lng, camera.destination.lat);
    for (const leg of camera.route.legs) {
      for (const point of leg.polyline ?? []) {
        extendBounds(bounds, point[0], point[1]);
      }
    }
    if (!bounds.isEmpty()) fitRouteBounds(map, bounds);
    setCamera(null);
  }, [map, camera, routeGeneration, isNavigating, search]);

  return null;
}
