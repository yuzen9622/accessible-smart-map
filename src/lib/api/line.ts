import { END_POINT } from "@/lib/config";
import { fetchRequest } from "@/lib/fetch";
import type { RoutePreviewQuery } from "@/types/line";

export async function getLineRoutePreview(query: RoutePreviewQuery) {
  const params = new URLSearchParams(
    "planToken" in query && query.planToken !== undefined
      ? { planToken: query.planToken }
      : { sessionId: query.sessionId },
  );
  return fetchRequest(`${END_POINT}/api/v1/line/route-preview?${params}`, {
    method: "GET",
  });
}
