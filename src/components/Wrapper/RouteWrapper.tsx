import {
  Bike,
  BusIcon,
  Car,
  Cone,
  Footprints,
  MapPin,
  TrainFrontIcon,
  TrainFrontTunnelIcon,
  TramFront,
  TriangleAlert,
} from "lucide-react";
import { Fragment, type JSX, useMemo } from "react";
import { Marker } from "react-map-gl/maplibre";
import { useShallow } from "zustand/react/shallow";
import { filterIncidentsAlongRoute } from "@/lib/geo";
import useMapStore from "@/stores/useMapStore";
import type {
  DriveLeg,
  DriveTrafficSegment,
  RouteLeg,
  WalkLeg,
} from "@/types/route";
import {
  A11Y_FEATURE_COLOR,
  getLegColor,
  TRAFFIC_LEVEL_COLORS,
  visibleTrafficSegments,
} from "@/types/route";
import Polyline from "../Polyline";

function polylineToPath(
  polyline: [number, number][],
): { lat: number; lng: number }[] {
  return polyline.map(([lng, lat]) => ({ lat, lng }));
}

function A11ySegmentOverlay({ leg, legKey }: { leg: WalkLeg; legKey: string }) {
  if (!leg.a11ySegments?.length) return null;

  return (
    <>
      {leg.a11ySegments.map((segment, segIdx) => {
        const color = A11Y_FEATURE_COLOR[segment.feature];
        const id = `${legKey}-${segment.feature}-${segment.startIndex}-${segment.endIndex}-${segIdx}`;

        // An elevator's two ends share one ground coordinate, so the slice is
        // a single point and cannot be drawn as a line.
        if (segment.startIndex === segment.endIndex) {
          const point = leg.polyline[segment.startIndex];
          if (!point) return null;
          return (
            <Marker
              key={id}
              longitude={point[0]}
              latitude={point[1]}
              anchor="center"
            >
              <div
                className="h-3 w-3 rounded-full border-2 border-white shadow"
                style={{ backgroundColor: color }}
              />
            </Marker>
          );
        }

        const path = polylineToPath(
          leg.polyline.slice(segment.startIndex, segment.endIndex + 1),
        );
        if (path.length < 2) return null;

        return (
          <Polyline
            key={id}
            id={id}
            path={path}
            strokeColor={color}
            strokeOpacity={0.95}
            strokeWeight={6}
            // Indoor geometry is a straight-line approximation between exit
            // proxies, not a surveyed path.
            dashArray={segment.indoor ? [1, 2] : undefined}
            lineCap="round"
            lineJoin="round"
          />
        );
      })}
    </>
  );
}

function DriveTrafficSegmentOverlay({
  leg,
  legKey,
  segments,
}: {
  leg: DriveLeg;
  legKey: string;
  segments: DriveTrafficSegment[];
}) {
  if (!segments.length) return null;

  return (
    <>
      {segments.map((segment, idx) => {
        const color =
          TRAFFIC_LEVEL_COLORS[segment.trafficLevel] ??
          TRAFFIC_LEVEL_COLORS.unknown;
        const id = `${legKey}-traffic-${segment.trafficLevel}-${segment.fromIndex}-${segment.toIndex}-${idx}`;

        const path = polylineToPath(
          leg.polyline.slice(segment.fromIndex, segment.toIndex + 1),
        );
        if (path.length < 2) return null;

        return (
          <Polyline
            key={id}
            id={id}
            path={path}
            strokeColor={color}
            strokeOpacity={1}
            strokeWeight={8}
            lineCap="round"
            lineJoin="round"
          />
        );
      })}
    </>
  );
}

function DriveIncidentOverlay({
  leg,
  legKey,
}: {
  leg: DriveLeg;
  legKey: string;
}) {
  const relevantIncidents = filterIncidentsAlongRoute(
    leg.incidents,
    leg.polyline,
    150,
  );
  if (!relevantIncidents.length) return null;

  return (
    <>
      {relevantIncidents.map((incident, idx) => {
        const isClosure = incident.severity === "closure";
        const tooltipText = incident.description
          ? `${incident.title}：${incident.description}`
          : incident.title;
        const id = `${legKey}-incident-${incident.incidentId || idx}`;

        return (
          <Marker
            key={id}
            longitude={incident.location.lng}
            latitude={incident.location.lat}
            anchor="center"
          >
            <div
              className={`flex h-5 w-5 items-center justify-center rounded-full border-2 border-white shadow ${
                isClosure ? "bg-red-600" : "bg-amber-500"
              }`}
              role="img"
              title={tooltipText}
              aria-label={tooltipText}
            >
              {isClosure ? (
                <TriangleAlert className="h-3 w-3 text-white" aria-hidden />
              ) : (
                <Cone className="h-3 w-3 text-white" aria-hidden />
              )}
            </div>
          </Marker>
        );
      })}
    </>
  );
}

function getLegIcon(leg: RouteLeg) {
  const color = getLegColor(leg);
  switch (leg.type) {
    case "WALK":
      return <Footprints className="h-4 w-4" style={{ color }} />;
    case "BUS":
      return <BusIcon className="h-4 w-4" style={{ color }} />;
    case "METRO":
      return <TramFront className="h-4 w-4" style={{ color }} />;
    case "THSR":
      return <TrainFrontTunnelIcon className="h-4 w-4" style={{ color }} />;
    case "TRA":
      return <TrainFrontIcon className="h-4 w-4" style={{ color }} />;
    case "DRIVE":
      return <Car className="h-4 w-4" style={{ color }} />;
    case "MOTORCYCLE":
      return <Bike className="h-4 w-4" style={{ color }} />;
  }
}

export default function RouteLine() {
  const { selectRoute, routeWaypoints, sosNavActive } = useMapStore(
    useShallow((s) => ({
      selectRoute: s.selectRoute,
      routeWaypoints: s.routeWaypoints,
      sosNavActive: s.sosNavActive,
    })),
  );

  const waypointMarkers = useMemo(() => {
    if (!routeWaypoints.length) return null;
    return routeWaypoints.map((wp, i) => (
      <Marker
        key={`wp-${wp.lat}-${wp.lng}`}
        longitude={wp.lng}
        latitude={wp.lat}
        anchor="bottom"
      >
        <div
          className="flex flex-col items-center"
          role="img"
          aria-label={`中繼站 ${i + 1}`}
        >
          <div className="flex items-center justify-center w-7 h-7 bg-blue-500 rounded-full border-2 border-background shadow-lg">
            <MapPin className="h-4 w-4 text-white" />
          </div>
        </div>
      </Marker>
    ));
  }, [routeWaypoints]);

  const polylinesElement = useMemo(() => {
    if (!selectRoute?.route) return null;

    const route = selectRoute.route;
    const markers: JSX.Element[] = [];
    let lastLegType: string | null = null;

    const allLegs = route.legs;
    if (!allLegs.length) return null;

    const firstLeg = allLegs[0];
    const lastLeg = allLegs[allLegs.length - 1];
    const firstPath = firstLeg.polyline?.length
      ? polylineToPath(firstLeg.polyline)
      : null;
    const lastPath = lastLeg.polyline?.length
      ? polylineToPath(lastLeg.polyline)
      : null;

    const startEndMarker = (
      <>
        {firstPath?.[0] && (
          <Marker
            longitude={firstPath[0].lng}
            latitude={firstPath[0].lat}
            anchor="center"
          >
            {/* Origin: hollow ring, same emerald as the plan-panel origin dot */}
            <div className="h-4.5 w-4.5 rounded-full bg-white dark:bg-zinc-900 border-[3.5px] border-emerald-500 shadow-[0_1px_4px_rgba(0,0,0,0.35)]" />
          </Marker>
        )}
        {!sosNavActive && lastPath?.[lastPath.length - 1] && (
          <Marker
            longitude={lastPath[lastPath.length - 1].lng}
            latitude={lastPath[lastPath.length - 1].lat}
            anchor="bottom"
          >
            {/* Destination: teardrop pin, same red as the plan-panel dot */}
            <div className="flex flex-col items-center pb-1.5 drop-shadow-[0_3px_4px_rgba(0,0,0,0.3)]">
              <div className="h-7 w-7 rotate-45 rounded-[50%_50%_0_50%] bg-gradient-to-br from-red-500 to-rose-600 border-2 border-white flex items-center justify-center">
                <div className="-rotate-45 h-2 w-2 rounded-full bg-white" />
              </div>
            </div>
          </Marker>
        )}
      </>
    );

    const stepLines = allLegs.map((leg) => {
      if (!leg.polyline?.length) return null;

      const path = polylineToPath(leg.polyline);
      const legKey = [
        leg.type,
        path[0]?.lng,
        path[0]?.lat,
        path[path.length - 1]?.lng,
        path[path.length - 1]?.lat,
        path.length,
      ].join("-");
      const color = getLegColor(leg);
      const isWalking = leg.type === "WALK";
      const isDriving = leg.type === "DRIVE" || leg.type === "MOTORCYCLE";
      const legId = `route-leg-${legKey}`;

      if (lastLegType !== null && lastLegType !== leg.type && path[0]) {
        markers.push(
          <Marker
            key={`marker-${legKey}`}
            longitude={path[0].lng}
            latitude={path[0].lat}
            anchor="center"
          >
            <div className="relative">
              <div
                className="flex items-center justify-center w-8 h-8 bg-white rounded-full border-2 shadow-lg relative z-10"
                style={{ borderColor: color }}
              >
                {getLegIcon(leg)}
              </div>
            </div>
          </Marker>,
        );
      }

      lastLegType = leg.type;

      if (isWalking) {
        return (
          <Fragment key={`leg-${legKey}`}>
            <Polyline
              key={legId}
              id={legId}
              path={path}
              strokeColor={color}
              strokeOpacity={0.8}
              strokeWeight={6}
              dashArray={[2, 4]}
              lineCap="round"
              lineJoin="round"
            />
            <A11ySegmentOverlay leg={leg} legKey={legId} />
          </Fragment>
        );
      }

      if (isDriving) {
        const segments = visibleTrafficSegments(
          leg.trafficSegments,
          leg.polyline.length,
        );

        // MapLibre has no z-index: the base line must mount before the
        // coloured segments so they paint on top of it.
        return (
          <Fragment key={`leg-${legKey}`}>
            <Polyline
              key={legId}
              id={legId}
              path={path}
              strokeColor={color}
              strokeOpacity={1}
              strokeWeight={8}
              lineCap="round"
              lineJoin="round"
            />
            <DriveTrafficSegmentOverlay
              leg={leg}
              legKey={legId}
              segments={segments}
            />
            <DriveIncidentOverlay leg={leg} legKey={legId} />
          </Fragment>
        );
      }

      return (
        <Polyline
          key={`leg-${legKey}`}
          id={legId}
          path={path}
          strokeColor={color}
          strokeOpacity={1}
          strokeWeight={8}
          lineCap="round"
          lineJoin="round"
        />
      );
    });

    return (
      <div>
        {stepLines}
        {markers}
        {startEndMarker}
      </div>
    );
  }, [selectRoute?.route, sosNavActive]);

  return (
    <>
      {polylinesElement}
      {waypointMarkers}
    </>
  );
}
