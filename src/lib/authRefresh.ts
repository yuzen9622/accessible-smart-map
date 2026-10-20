import { requestRefresh } from "@/lib/authTransport";

/**
 * Shared single-flight auth refresh coordination layer (plan §4
 * authRefresh.ts row, §5.8, §7.1 cases 19/20/20b/23/24/25/27/28).
 *
 * Dependency direction (no cycle): this module only static-imports
 * `authTransport.ts`. It never imports the store — reads/writes to auth
 * state go through a port injected via `configureAuthState`, registered by
 * `useAuthStore.ts` at module load time.
 */

export interface AuthSession {
  accessToken: string;
}

export interface AuthStatePort {
  getSession(): AuthSession | null;
  /** Monotonic identity epoch also protects a null-session logout/relogin (ABA). */
  getIdentityEpoch?(): number;
  setSession(session: { accessToken: string }): void;
  /** authRefresh only ever clears the user (never sets a real one). */
  setUser(user: null): void;
}

let authStatePort: AuthStatePort | null = null;

/** Registered once by `useAuthStore.ts` after the store is created. */
export function configureAuthState(port: AuthStatePort): void {
  authStatePort = port;
}

interface RefreshLane {
  /** Session identity (object reference) this lane was started for. */
  sessionAtStart: AuthSession | null;
  identityEpoch: number | undefined;
  promise: Promise<string | null>;
}

let inFlight: RefreshLane | null = null;

/**
 * Single-flight, session-identity-scoped token refresh.
 *
 * Atomic reentrant loop: each iteration reads the in-flight lane and the
 * current session reference, then either joins/creates a lane or (if the
 * in-flight lane belongs to a different identity) waits for it to settle
 * and re-checks. The join/create decision for a given identity always
 * happens inside one synchronous stretch (no `await` in between reading
 * `inFlight` and installing/returning a lane) — JS's run-to-completion
 * semantics make that section atomic without any explicit lock, so two
 * concurrent callers for the same identity can never install two lanes.
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (!authStatePort) {
    console.error(
      "[authRefresh] configureAuthState was never called; refreshAccessToken resolving null",
    );
    return null;
  }
  const port = authStatePort;

  for (;;) {
    const existing = inFlight;
    const cur = port.getSession();

    if (!existing) {
      const sessionAtStart = cur;
      const identityEpoch = port.getIdentityEpoch?.();
      const lane: RefreshLane = {
        sessionAtStart,
        identityEpoch,
        promise: runRefresh(port, sessionAtStart, identityEpoch),
      };
      inFlight = lane;
      lane.promise.finally(() => {
        if (inFlight === lane) {
          inFlight = null;
        }
      });
      return lane.promise;
    }

    if (
      existing.sessionAtStart === cur &&
      existing.identityEpoch === port.getIdentityEpoch?.()
    ) {
      // Same identity as the in-flight lane — join it.
      return existing.promise;
    }

    // A lane is in flight, but for a different identity than the one we see
    // now. It's irrelevant to us: wait for it to settle (ignore its result)
    // and re-check — this is what lets N new-identity callers merge into a
    // single new lane once the stale one clears, and what lets the identity
    // change again (B -> C) while we wait be handled by another reentry.
    await existing.promise.catch(() => undefined);
  }
}

async function runRefresh(
  port: AuthStatePort,
  sessionAtStart: AuthSession | null,
  identityEpoch: number | undefined,
): Promise<string | null> {
  const newToken = await requestRefresh();

  if (
    port.getSession() !== sessionAtStart ||
    port.getIdentityEpoch?.() !== identityEpoch
  ) {
    // Identity changed while the transport call was in flight — logout,
    // logout-then-relogin (ABA), or the session was replaced by some other
    // source. Never commit and never invalidate someone else's session;
    // every waiter just gets null.
    return null;
  }

  if (newToken) {
    port.setSession({ accessToken: newToken });
    return newToken;
  }

  // Same identity, genuine failure — mirrors the pre-refactor fetch.ts
  // semantics (fetch.ts:74-75) of clearing session + user on failed refresh.
  port.setSession({ accessToken: "" });
  port.setUser(null);
  return null;
}

/**
 * Compare-and-invalidate: only clears auth state if the current session is
 * still exactly the reference passed in. Used by `fetch.ts` when a retried
 * request still comes back 401, so a session replaced in the meantime (by a
 * logout, relogin, or another refresh) is never clobbered.
 */
export function invalidateSession(sessionRef: AuthSession | null): void {
  if (!authStatePort) {
    return;
  }
  if (authStatePort.getSession() === sessionRef) {
    authStatePort.setSession({ accessToken: "" });
    authStatePort.setUser(null);
  }
}
