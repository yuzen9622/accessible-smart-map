import { END_POINT } from "@/lib/config";
import {
  ApiError,
  authenticatedRequest,
  fetchRequest,
  getAccessToken,
} from "@/lib/fetch";
import type { IBathroom, metroA11yData } from "@/types";
import type { ApiResponse } from "@/types/response";
import type {
  A11yFacility,
  AccessibleRouteData,
  AccessibleRouteRequest,
  AccessibleRouteRerouteData,
  AccessibleRouteRerouteRequest,
  EnvironmentData,
  HazardReport,
  NavInstructionsData,
  NavInstructionsRequest,
  OsmPlaceDetail,
  ParkingNearbyItem,
  WelfareInstitution,
} from "@/types/route";

export async function getAllA11yFacilities() {
  const response = await fetchRequest<ApiResponse<null>>(
    // Only these categories have map pins; filtering server-side cuts the
    // payload from ~5MB/24.7k items to ~1.6MB/7.9k items.
    `${END_POINT}/api/v1/a11y/all-facilities?category=elevator,ramp,toilet`,
  );
  return response as ApiResponse<A11yFacility[]>;
}

export async function getNearbyRouteA11yPlaces(
  point: {
    lat: number;
    lng: number;
  },
  signal?: AbortSignal,
) {
  const response = await fetchRequest<
    ApiResponse<{
      nearbyBathroom: IBathroom[];
      nearbyMetroA11y: metroA11yData[];
    }>
  >(
    `${END_POINT}/api/v1/a11y/nearby-a11y?lat=${point.lat}&lng=${point.lng}`,
    signal ? { signal } : undefined,
  );

  return response as ApiResponse<{
    nearbyBathroom: IBathroom[];
    nearbyMetroA11y: metroA11yData[];
  }>;
}

export async function getAccessibleRoute(request: AccessibleRouteRequest) {
  const response = await fetchRequest(
    `${END_POINT}/api/v1/a11y/accessible-route`,
    {
      method: "POST",
      body: request,
    },
  );
  return response as ApiResponse<AccessibleRouteData>;
}

export async function rerouteAccessibleRoute(
  request: AccessibleRouteRerouteRequest,
) {
  const response = await fetchRequest(
    `${END_POINT}/api/v1/a11y/accessible-route/reroute`,
    {
      method: "POST",
      body: request,
    },
  );
  return response as ApiResponse<AccessibleRouteRerouteData>;
}

export async function getRouteInstructions(request: NavInstructionsRequest) {
  const response = await fetchRequest(
    `${END_POINT}/api/v1/a11y/route/instructions`,
    { method: "POST", body: request },
  );
  return response as ApiResponse<NavInstructionsData>;
}

export async function getOsmPlaceDetail(osmId: string, signal?: AbortSignal) {
  const response = await fetchRequest(
    `${END_POINT}/api/v1/a11y/place?osmId=${osmId}`,
    signal ? { signal } : undefined,
  );
  return response as ApiResponse<OsmPlaceDetail | OsmPlaceDetail[]>;
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
  let data: ApiResponse<HazardReport>;
  if (hasBody) {
    try {
      data = (await response.json()) as ApiResponse<HazardReport>;
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
    } as ApiResponse<HazardReport>;
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

export async function getNearbyHazardReports(
  lat: number,
  lng: number,
  radius = 500,
  signal?: AbortSignal,
) {
  const response = await fetchRequest(
    `${END_POINT}/api/v1/a11y/reports?lat=${lat}&lng=${lng}&radius=${radius}`,
    signal ? { signal } : undefined,
  );
  return response as ApiResponse<{ reports: HazardReport[]; total: number }>;
}

export async function getMyHazardReports() {
  const response = await authenticatedRequest(
    `${END_POINT}/api/v1/a11y/reports/mine`,
  );
  return response as ApiResponse<HazardReport[]>;
}

export async function confirmHazardReport(id: string, confirm: boolean) {
  const response = await fetchRequest(
    `${END_POINT}/api/v1/a11y/reports/${id}/confirm`,
    { method: "POST", body: { confirm } },
  );
  return response as ApiResponse<unknown>;
}

export async function getNearbyWelfare(
  lat: number,
  lng: number,
  radius = 1000,
) {
  const response = await fetchRequest(
    `${END_POINT}/api/v1/a11y/welfare/nearby?lat=${lat}&lng=${lng}&radius=${radius}`,
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

export async function getNearbyParking(lat: number, lng: number) {
  const response = await fetchRequest(
    `${END_POINT}/api/v1/a11y/parking/nearby?lat=${lat}&lng=${lng}`,
  );
  return response as ApiResponse<ParkingNearbyItem[]>;
}
