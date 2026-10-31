import { END_POINT } from "@/lib/config";
import {
  ApiError,
  authenticatedRequest,
  fetchRequest,
  getAccessToken,
  personalizedRequest,
} from "@/lib/fetch";
import { isValidPlaceBounds } from "@/lib/place/placeBounds";
import { withRouteNameLanguage } from "@/lib/route/sourceNames";
import type { IBathroom, metroA11yData } from "@/types";
import type { NearbyA11ySummary, PlaceBounds } from "@/types/place";
import type { ApiResponse } from "@/types/response";
import type {
  A11yFacility,
  AccessibleRoute,
  AccessibleRouteData,
  AccessibleRouteRequest,
  AccessibleRouteRerouteData,
  AccessibleRouteRerouteRequest,
  EnvironmentData,
  HazardReport,
  HazardSeverity,
  NavInstructionsData,
  NavInstructionsRequest,
  OsmPlaceDetail,
  ParkingNearbyItem,
  SafetyHazardReport,
  WelfareInstitution,
} from "@/types/route";
import { parseDepartureCandidate } from "./busParsers";

export async function getAllA11yFacilities(lang?: string) {
  const response = await fetchRequest<ApiResponse<null>>(
    // Only these categories have map pins; filtering server-side cuts the
    // payload from ~5MB/24.7k items to ~1.6MB/7.9k items.
    `${END_POINT}/api/v1/a11y/all-facilities?category=elevator,ramp,toilet${lang ? `&${new URLSearchParams({ lang })}` : ""}`,
  );
  return response as ApiResponse<A11yFacility[]>;
}

export async function getNearbyRouteA11yPlaces(
  point: {
    lat: number;
    lng: number;
  },
  signal: AbortSignal | undefined,
  lang: string | undefined,
  bounds: PlaceBounds,
) {
  if (!isValidPlaceBounds(bounds)) {
    throw new Error("Valid place bounds are required for nearby facilities");
  }
  const query = new URLSearchParams({
    lat: String(point.lat),
    lng: String(point.lng),
    bbox: bounds.join(","),
  });
  if (lang) query.set("lang", lang);
  const response = await fetchRequest<ApiResponse<NearbyRouteA11yData>>(
    `${END_POINT}/api/v1/a11y/nearby-a11y?${query.toString()}`,
    signal ? { signal } : undefined,
  );

  return response as ApiResponse<NearbyRouteA11yData>;
}

interface NearbyRouteA11yData {
  nearbyBathroom: IBathroom[];
  nearbyMetroA11y: metroA11yData[];
  // Absent from backends deployed before the summary existed.
  summary?: NearbyA11ySummary;
}

export async function getAccessibleRoute(
  request: AccessibleRouteRequest,
  signal?: AbortSignal,
) {
  const response = await fetchRequest(
    `${END_POINT}/api/v1/a11y/accessible-route`,
    {
      method: "POST",
      body: request,
      signal,
    },
  );
  const result = response as ApiResponse<AccessibleRouteData>;
  if (result.data?.routes) {
    result.data.routes = result.data.routes.map((route) =>
      withRouteNameLanguage(route, request.language),
    );
  }
  return result;
}

export async function rerouteAccessibleRoute(
  request: AccessibleRouteRerouteRequest,
  signal?: AbortSignal,
) {
  const response = await fetchRequest(
    `${END_POINT}/api/v1/a11y/accessible-route/reroute`,
    {
      method: "POST",
      body: request,
      signal,
    },
  );
  const result = response as ApiResponse<AccessibleRouteRerouteData>;
  if (result.data?.route) {
    // A replay retains the FIRST request's language, which is not echoed.
    // Use source names instead of relabelling old display values as current.
    result.data.route = withRouteNameLanguage(
      result.data.route,
      result.data.replayed ? undefined : request.language,
    );
  }
  return result;
}

export async function selectBusDeparture(
  request: { routeToken: string; legIndex: number; candidateId: string },
  signal?: AbortSignal,
): Promise<ApiResponse<{ route: AccessibleRoute }>> {
  const result = (await fetchRequest(
    `${END_POINT}/api/v1/a11y/accessible-route/bus-selection`,
    { method: "POST", body: request, signal },
  )) as ApiResponse<{ route: AccessibleRoute }>;
  if (result.ok) {
    const route = result.data?.route;
    const leg = route?.legs?.[request.legIndex];
    if (
      !route?.routeToken ||
      route.routeToken === request.routeToken ||
      !route.navigationId ||
      !Number.isInteger(route.routeVersion) ||
      (route.routeVersion ?? 0) < 1 ||
      leg?.type !== "BUS" ||
      !leg.selectedDeparture ||
      !Array.isArray(leg.polyline) ||
      leg.polyline.length < 2 ||
      !leg.polyline.every(
        (point) =>
          Array.isArray(point) &&
          point.length === 2 &&
          point.every(Number.isFinite),
      )
    )
      throw new TypeError("Invalid selected bus route");
    leg.selectedDeparture = parseDepartureCandidate(leg.selectedDeparture);
    if (!leg.selectedDeparture.selected)
      throw new TypeError("Invalid selected bus route");
    result.data = { route: withRouteNameLanguage(route) };
  }
  return result;
}

export async function getRouteInstructions(request: NavInstructionsRequest) {
  const response = await fetchRequest(
    `${END_POINT}/api/v1/a11y/route/instructions`,
    {
      method: "POST",
      body: {
        routeToken: request.routeToken,
        ...(request.userHeading === undefined
          ? {}
          : { userHeading: request.userHeading }),
        ...(request.language === undefined
          ? {}
          : { language: request.language }),
      },
    },
  );
  return response as ApiResponse<NavInstructionsData>;
}

export async function getOsmPlaceDetail(
  osmId: string,
  signal?: AbortSignal,
  lang?: string,
) {
  const response = await fetchRequest(
    `${END_POINT}/api/v1/a11y/place?osmId=${osmId}${lang ? `&${new URLSearchParams({ lang })}` : ""}`,
    signal ? { signal } : undefined,
  );
  return response as ApiResponse<OsmPlaceDetail | OsmPlaceDetail[]>;
}

export interface CreateHazardReportData {
  report?: HazardReport;
  merged?: boolean;
  _id?: string;
  hazardType?: string;
  severity?: HazardSeverity;
  latitude?: number;
  longitude?: number;
}

export async function createHazardReport(formData: FormData) {
  const token = await getAccessToken();
  const response = await fetch(`${END_POINT}/api/v1/a11y/reports`, {
    method: "POST",
    credentials: "include",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  });

  const hasBody = response.status !== 204 && response.status !== 205;
  let data: ApiResponse<CreateHazardReportData>;
  if (hasBody) {
    try {
      data = (await response.json()) as ApiResponse<CreateHazardReportData>;
    } catch {
      throw new ApiError(
        response.statusText || "Failed to submit hazard report",
        response.status,
      );
    }
  } else {
    data = {
      ok: response.ok,
      status: response.ok ? "success" : "error",
      code: response.status,
      message: response.statusText,
    } as ApiResponse<CreateHazardReportData>;
  }

  const isSuccess = data.ok === true || data.success === true;
  if (!isSuccess) {
    throw new ApiError(
      data.message || "Failed to submit hazard report",
      data.code || response.status,
      (data.data as { reason?: string } | undefined)?.reason,
      data.data,
    );
  }

  return data;
}

/** Anonymous safety signals remain available even when a content author is blocked. */
export async function getSafetyHazardReports(
  lat: number,
  lng: number,
  radius = 500,
  signal?: AbortSignal,
) {
  const response = await fetchRequest(
    `${END_POINT}/api/v1/a11y/reports/safety?${new URLSearchParams({ lat: String(lat), lng: String(lng), radius: String(radius) })}`,
    { signal },
  );
  return response as ApiResponse<{
    reports: SafetyHazardReport[];
    total: number;
  }>;
}

export async function getNearbyHazardReports(
  lat: number,
  lng: number,
  radius = 500,
  signal?: AbortSignal,
) {
  const response = await personalizedRequest(
    `${END_POINT}/api/v1/a11y/reports?lat=${lat}&lng=${lng}&radius=${radius}`,
    signal ? { signal } : undefined,
  );
  return response as ApiResponse<{ reports: HazardReport[]; total: number }>;
}

export async function getHazardReport(id: string, signal?: AbortSignal) {
  const response = await personalizedRequest(
    `${END_POINT}/api/v1/a11y/reports/${encodeURIComponent(id)}`,
    { signal },
  );
  return response as ApiResponse<{ report: HazardReport }>;
}

export async function getMyHazardReports(
  cursor?: string,
  signal?: AbortSignal,
) {
  const query = cursor ? `?${new URLSearchParams({ cursor })}` : "";
  const response = await authenticatedRequest(
    `${END_POINT}/api/v1/a11y/reports/mine${query}`,
    { signal },
  );
  return response as ApiResponse<{
    reports: HazardReport[];
    total: number;
    nextCursor?: string | null;
  }>;
}

export async function confirmHazardReport(
  id: string,
  action: "confirm" | "deny",
) {
  const token = await getAccessToken();
  const response = await fetchRequest(
    `${END_POINT}/api/v1/a11y/reports/${id}/confirm`,
    {
      method: "POST",
      body: { action },
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
  return response as ApiResponse<{
    reportId: string;
    action: "confirm" | "deny";
    confirmCount: number;
    denyCount: number;
  }>;
}

export async function getNearbyWelfare(
  lat: number,
  lng: number,
  radius = 1000,
  lang?: string,
) {
  const response = await fetchRequest(
    `${END_POINT}/api/v1/a11y/welfare/nearby?lat=${lat}&lng=${lng}&radius=${radius}${lang ? `&${new URLSearchParams({ lang })}` : ""}`,
  );
  return response as ApiResponse<WelfareInstitution[]>;
}

export async function getWelfareDetail(id: string) {
  const response = await fetchRequest(`${END_POINT}/api/v1/a11y/welfare/${id}`);
  return response as ApiResponse<WelfareInstitution>;
}

export async function getEnvironmentInfo(lat: number, lng: number) {
  const response = await fetchRequest(
    `${END_POINT}/api/v1/a11y/environment?lat=${lat}&lng=${lng}`,
  );
  return response as ApiResponse<EnvironmentData>;
}

export async function getNearbyParking(
  lat: number,
  lng: number,
  lang?: string,
) {
  const response = await fetchRequest(
    `${END_POINT}/api/v1/a11y/parking/nearby?lat=${lat}&lng=${lng}${lang ? `&${new URLSearchParams({ lang })}` : ""}`,
  );
  return response as ApiResponse<ParkingNearbyItem[]>;
}
