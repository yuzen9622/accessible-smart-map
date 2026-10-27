import { lazy, Suspense, useMemo } from "react";
import { Marker } from "react-map-gl/maplibre";
import { useShallow } from "zustand/react/shallow";
import { buildCumulativePath } from "@/lib/geo";
import { matchesProgressIdentity } from "@/lib/navigation/navigationProgress";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import { ErrorBoundary } from "./ErrorBoundary";

const NavigationBusLayer = lazy(
  () => import("@/components/Navigation/NavigationBusLayer"),
);

export default function NowPin() {
  const userLocation = useMapStore((s) => s.userLocation);
  const isNavigating = useMapStore((s) => s.isNavigating);
  // Selector subscription: only NowPin re-renders on heading ticks.
  const userHeading = useNavStore((s) => s.userHeading);
  const route = useMapStore(
    (s) => s.activeNavigationRoute ?? s.selectRoute?.route,
  );
  const {
    routeProgress,
    navigationMode,
    navigationId,
    routeVersion,
    navigationSource,
    transitRide,
    voiceTransit,
  } = useNavStore(
    useShallow((s) => ({
      routeProgress: s.routeProgress,
      navigationMode: s.navigationMode,
      navigationId: s.navigationId,
      routeVersion: s.routeVersion,
      navigationSource: s.navigationSource,
      transitRide: s.transitRide,
      voiceTransit: s.voiceTransit,
    })),
  );
  const path = useMemo(() => buildCumulativePath(route?.legs ?? []), [route]);
  const ridingBus =
    isNavigating &&
    navigationMode === "live" &&
    route &&
    routeProgress &&
    matchesProgressIdentity(routeProgress, {
      routeToken: route.routeToken ?? route.routeId,
      navigationId,
      routeVersion,
    }) &&
    route.legs[routeProgress.legIndex]?.type === "BUS" &&
    (navigationSource === "voice"
      ? voiceTransit?.onVehicle && voiceTransit.leg?.mode === "BUS"
      : transitRide?.boarded &&
        transitRide.key ===
          JSON.stringify([
            route.routeToken,
            route.navigationId,
            route.routeVersion,
            routeProgress.legIndex,
          ]));

  const hasHeading = userHeading != null;
  const showNavigationArrow = isNavigating && hasHeading;

  const marker = userLocation ? (
    <Marker
      longitude={userLocation.lng}
      latitude={userLocation.lat}
      anchor="center"
      // Map-aligned rotation: the up-pointing cone tracks the true ground
      // heading regardless of how far the map camera has rotated.
      rotation={hasHeading ? userHeading : 0}
      rotationAlignment="map"
    >
      <div
        className="relative flex items-center justify-center"
        style={{
          width: isNavigating ? 56 : 40,
          height: isNavigating ? 56 : 40,
        }}
      >
        {isNavigating ? (
          showNavigationArrow ? (
            <svg
              aria-hidden="true"
              className="relative z-10 h-[34px] w-[34px] drop-shadow-md"
              viewBox="0 0 36 36"
            >
              <path
                d="M18 2.5 31.5 30 18 25.8 4.5 30 18 2.5Z"
                fill="#2563eb"
                stroke="white"
                strokeLinejoin="round"
                strokeWidth="2.5"
              />
            </svg>
          ) : (
            <>
              <div className="w-8 h-8 rounded-full bg-blue-500/15 absolute" />
              <div className="w-5 h-5 rounded-full bg-blue-600 border-[2.5px] border-white shadow-[0_0_0_1.5px_rgba(37,99,235,0.3),0_2px_6px_rgba(0,0,0,0.3)] relative z-10" />
            </>
          )
        ) : (
          <>
            <div className="w-9 h-9 rounded-full bg-blue-500/25 animate-ping absolute" />
            <div className="w-8 h-8 rounded-full bg-blue-500/15 absolute" />
            {hasHeading && (
              <div
                className="absolute left-1/2 -translate-x-1/2"
                style={{
                  top: -2,
                  width: 0,
                  height: 0,
                  borderLeft: "7px solid transparent",
                  borderRight: "7px solid transparent",
                  borderBottom: "14px solid #2563eb",
                  filter: "drop-shadow(0 1px 2px rgba(37,99,235,0.4))",
                }}
              />
            )}
            <div className="w-5 h-5 rounded-full bg-blue-600 border-[2.5px] border-white shadow-[0_0_0_1.5px_rgba(37,99,235,0.3),0_2px_6px_rgba(0,0,0,0.3)] relative z-10" />
          </>
        )}
      </div>
    </Marker>
  ) : null;
  return ridingBus ? (
    <ErrorBoundary fallback={() => marker}>
      <Suspense fallback={marker}>
        <NavigationBusLayer
          path={path}
          progress={routeProgress}
          fallback={marker}
        />
      </Suspense>
    </ErrorBoundary>
  ) : (
    marker
  );
}
