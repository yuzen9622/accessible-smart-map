import { END_POINT } from "@/lib/config";

/** DTO paths already contain /api/v1. Resolve from the backend origin, not
 * the frontend origin or an API-prefix URL. Public views never guess /photo. */
export function resolvePublicHazardPhotoUrl(
  value: string | null | undefined,
  backendEndpoint = END_POINT,
): string | null {
  if (!value) return null;
  try {
    const backend = new URL(backendEndpoint);
    const url = new URL(value, `${backend.origin}/`);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== backend.origin ||
      url.username ||
      url.password ||
      !/^\/api\/v1\/a11y\/reports\/[^/]+\/photo\/public\/?$/.test(url.pathname)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
