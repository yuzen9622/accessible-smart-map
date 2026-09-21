"use client";

import { LngLatBounds } from "maplibre-gl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getLineRoutePreview } from "@/lib/api/line";
import { extendBounds, fitRouteBounds } from "@/lib/mapCamera";
import { adaptRoutePreviewRoutes } from "@/lib/routePreviewAdapter";
import useMapStore from "@/stores/useMapStore";
import type { PlaceDetail } from "@/types";
import type { RoutePreviewPageData } from "@/types/line";
import type { AccessibleRoute } from "@/types/route";

function coordinatePlace(label: string, lat?: number, lng?: number) {
  if (lat == null || lng == null) return null;
  return {
    kind: "coordinate",
    address: label,
    position: { lat, lng },
  } satisfies PlaceDetail;
}

function getSessionId(
  searchParams: ReturnType<typeof useSearchParams>,
): string | null {
  const direct = searchParams.get("sessionId");
  if (direct) return direct;

  const liffState = searchParams.get("liff.state");
  if (liffState) {
    try {
      const queryStart = liffState.indexOf("?");
      const queryString =
        queryStart !== -1
          ? liffState.substring(queryStart)
          : liffState.includes("=")
            ? `?${liffState}`
            : "";
      if (queryString) {
        const parsed = new URLSearchParams(queryString);
        return parsed.get("sessionId");
      }
    } catch (e) {
      console.error("Failed to parse liff.state:", e);
    }
  }

  return null;
}

export default function RoutePreviewHydrator() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const {
    map,
    setComputeRoutes,
    setRouteSelect,
    setRouteInfoShow,
    setSheetMode,
    setRouteSubPanel,
    setOrigin,
    setDestination,
    setOriginName,
    setDestinationName,
  } = useMapStore(
    useShallow((s) => ({
      map: s.map,
      setComputeRoutes: s.setComputeRoutes,
      setRouteSelect: s.setRouteSelect,
      setRouteInfoShow: s.setRouteInfoShow,
      setSheetMode: s.setSheetMode,
      setRouteSubPanel: s.setRouteSubPanel,
      setOrigin: s.setOrigin,
      setDestination: s.setDestination,
      setOriginName: s.setOriginName,
      setDestinationName: s.setDestinationName,
    })),
  );

  const [sessionData, setSessionData] = useState<RoutePreviewPageData | null>(
    null,
  );
  const [selectedRouteData, setSelectedRouteData] =
    useState<AccessibleRoute | null>(null);
  const [hasCentered, setHasCentered] = useState(false);

  // We track the last fetched sessionId to prevent duplicate fetching
  const fetchedSessionIdRef = useRef<string | null>(null);

  const sessionId = getSessionId(searchParams);

  // 1. Fetching Effect
  useEffect(() => {
    if (!sessionId || fetchedSessionIdRef.current === sessionId) return;

    let cancelled = false;
    fetchedSessionIdRef.current = sessionId;

    const clearQuery = () => {
      router.replace(pathname, { scroll: false });
    };

    const hydrate = async () => {
      try {
        const response = await getLineRoutePreview(sessionId);
        if (cancelled || !response.data?.routes?.length) {
          if (!cancelled) {
            fetchedSessionIdRef.current = null;
            clearQuery();
          }
          return;
        }

        const preview = response.data;
        const routes = adaptRoutePreviewRoutes(preview.routes);
        const selectedRoute = routes[0];
        if (!selectedRoute) {
          fetchedSessionIdRef.current = null;
          clearQuery();
          return;
        }

        // Save locally to trigger camera centering and UI updates
        setSessionData(preview);
        setSelectedRouteData(selectedRoute);
        setHasCentered(false);

        // Update global store
        setComputeRoutes(routes);
        setRouteSelect({ index: 0, route: selectedRoute });
        setRouteInfoShow(true);
        setSheetMode("route");
        setRouteSubPanel("none");
        setOriginName(preview.origin.label);
        setDestinationName(preview.destination.label);
        setOrigin(
          coordinatePlace(
            preview.origin.label,
            preview.origin.lat,
            preview.origin.lng,
          ),
        );
        setDestination(
          coordinatePlace(
            preview.destination.label,
            preview.destination.lat,
            preview.destination.lng,
          ),
        );

        // Clear query string from URL since we have successfully loaded the route
        clearQuery();
      } catch (_err) {
        fetchedSessionIdRef.current = null;
        clearQuery();
      }
    };

    hydrate();

    return () => {
      cancelled = true;
      if (fetchedSessionIdRef.current === sessionId) {
        fetchedSessionIdRef.current = null;
      }
    };
  }, [
    sessionId,
    pathname,
    router,
    setRouteSubPanel,
    setComputeRoutes,
    setDestination,
    setDestinationName,
    setOrigin,
    setOriginName,
    setRouteInfoShow,
    setRouteSelect,
    setSheetMode,
  ]);

  // 2. Camera Centering Effect - Runs as soon as map becomes ready and we have route data
  useEffect(() => {
    if (!map || !sessionData || !selectedRouteData || hasCentered) return;

    const bounds = new LngLatBounds();
    extendBounds(bounds, sessionData.origin.lng, sessionData.origin.lat);
    extendBounds(
      bounds,
      sessionData.destination.lng,
      sessionData.destination.lat,
    );
    for (const leg of selectedRouteData.legs) {
      for (const point of leg.polyline ?? []) {
        extendBounds(bounds, point?.[0], point?.[1]);
      }
    }
    if (!bounds.isEmpty()) {
      fitRouteBounds(map, bounds);
      setHasCentered(true);
    }
  }, [map, sessionData, selectedRouteData, hasCentered]);

  return null;
}
