/**
 * Persist the victim's own active SOS session across page reloads.
 *
 * The SOS lifecycle otherwise lives entirely in `SosDialog` component state,
 * so a refresh (or an accidental navigation) would silently drop an active
 * emergency. The session id is always re-validated against `GET /sessions/:id`;
 * the opaque share token is retained only so the owner can keep sharing the
 * same public link after a reload.
 */

const KEY = "sos.activeSession";
// Don't resurrect a session the user forgot about days later; the server
// would likely have expired it anyway.
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12h

export interface StoredSos {
  sessionId: string;
  shareToken: string | null;
  savedAt: number;
}

export function saveActiveSos(
  sessionId: string,
  shareToken: string | null,
): void {
  if (typeof window === "undefined") return;
  try {
    const payload: StoredSos = { sessionId, shareToken, savedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // storage unavailable (private mode / quota) — recovery just won't work
  }
}

export function loadActiveSos(): StoredSos | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSos>;
    if (!parsed?.sessionId) return null;
    if (Date.now() - (parsed.savedAt ?? 0) > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return {
      sessionId: parsed.sessionId,
      shareToken:
        typeof parsed.shareToken === "string" ? parsed.shareToken : null,
      savedAt: parsed.savedAt ?? 0,
    };
  } catch {
    return null;
  }
}

export function clearActiveSos(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
