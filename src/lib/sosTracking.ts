import type { SosPublicSession, SosSnapshot } from "@/types/sos";

export type TrackableSosSession = SosPublicSession & {
  status: "active";
  lat: number;
  lng: number;
  updatedAt: string;
};

/** Reads the public share token from the URL fragment, with legacy query fallbacks. */
export function readSosTrackingToken(
  location: Pick<Location, "hash" | "search">,
  legacySearchKeys: readonly string[] = ["token"],
): string | null {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  const fragmentToken = fragment.get("token")?.trim();
  if (fragmentToken) return fragmentToken;

  const search = new URLSearchParams(location.search);
  for (const key of legacySearchKeys) {
    const token = search.get(key)?.trim();
    if (token) return token;
  }
  return null;
}

/** Builds a tracking link without exposing the share token to HTTP logs or Referer headers. */
export function buildSosTrackingUrl(
  origin: string,
  language: string,
  shareToken: string,
): string {
  return `${origin.replace(/\/+$/, "")}/${language}/sos/#token=${encodeURIComponent(shareToken)}`;
}

export function isTrackableSosSession(
  session: SosPublicSession,
): session is TrackableSosSession {
  return (
    session.status === "active" &&
    typeof session.lat === "number" &&
    Number.isFinite(session.lat) &&
    typeof session.lng === "number" &&
    Number.isFinite(session.lng) &&
    typeof session.updatedAt === "string"
  );
}

/** Decays the anonymous viewer list using the server-provided activity window. */
export function countActiveSosViewers(
  snapshot: SosSnapshot | null,
  now = Date.now(),
): number {
  if (
    !snapshot?.viewers ||
    typeof snapshot.viewerActiveWindowSeconds !== "number" ||
    snapshot.viewerActiveWindowSeconds < 0
  ) {
    return 0;
  }
  const activeSince = now - snapshot.viewerActiveWindowSeconds * 1000;
  return snapshot.viewers.filter(
    ({ lastSeenAt }) => new Date(lastSeenAt).getTime() >= activeSince,
  ).length;
}
