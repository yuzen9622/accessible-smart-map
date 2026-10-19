import { toast } from "sonner";
import { invalidateSession, refreshAccessToken } from "@/lib/authRefresh";
import useAuthStore from "@/stores/useAuthStore";
import type { ApiResponse } from "@/types/response";

interface RequestOptions<T> {
  method?: string;
  credentials?: RequestCredentials;
  body?: T;
  headers?: Record<string, string>;
  requireAuth?: boolean;
  /** Bind a sensitive request and every auth retry to its originating account. */
  isCurrentSession?: () => boolean;
  /** Business permission failures must not discard a valid login. */
  preserveSessionOnForbidden?: boolean;
  signal?: AbortSignal;
  cache?: RequestCache;
  /**
   * Some authenticated endpoints reuse 401 for a business-logic error
   * (e.g. POST /user/auth/password's "current password wrong") rather
   * than "token invalid". Set this so a 401 there is returned as-is for
   * the caller to check `res.ok`, instead of triggering the normal
   * refresh-retry-then-invalidate-session flow, which would otherwise
   * silently log the user out on a mistyped password.
   */
  skipAuthRetry?: boolean;
}

/**
 * Internal-only extension of `RequestOptions`, used solely by this module's
 * own 401-retry recursion. `__retried` is not part of the exported
 * `RequestOptions` type, so ordinary callers cannot set it.
 */
interface InternalRequestOptions<T> extends RequestOptions<T> {
  __retried?: boolean;
}

export async function getAccessToken() {
  return useAuthStore.getState().session?.accessToken;
}

export class ApiError extends Error {
  code: number;
  reason?: string;
  /** Raw `data` payload from the error envelope — e.g. a 400's
   * `{ errors: [{ path, message }] }` field-validation list, which the
   * top-level `message`/`reason` don't carry. */
  data?: unknown;

  constructor(message: string, code: number, reason?: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.reason = reason;
    this.data = data;
  }
}

export async function fetchRequest<T>(
  url: string,
  options: RequestOptions<T> = {},
): Promise<ApiResponse<unknown>> {
  const {
    method = "GET",
    body,
    headers = {},
    requireAuth = false,
    signal,
    skipAuthRetry = false,
    isCurrentSession,
    preserveSessionOnForbidden = false,
    __retried,
    ...rest
  } = options as InternalRequestOptions<T>;
  // Captured at the very start of *this* invocation (original or retry),
  // before any await — this is the "session ref right before the retry
  // fires" that the retry-still-401 path invalidates via compare-and-commit.
  const sessionAtEntry = useAuthStore.getState().session;
  const assertCurrentSession = () => {
    if (isCurrentSession && !isCurrentSession()) {
      throw new DOMException("Account changed", "AbortError");
    }
  };
  assertCurrentSession();
  if (requireAuth) {
    const token = await getAccessToken();
    assertCurrentSession();
    headers.Authorization = `Bearer ${token}`;
  }
  const init: RequestInit = {
    method,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    ...rest,
  };

  if (body) {
    init.body = JSON.stringify(body);
  }
  // `signal` is destructured out of options above, so it never reaches fetch
  // via `...rest` — it has to be reattached explicitly. Without this, every
  // AbortController and setTimeout-based request timeout in the app is a no-op.
  if (signal) {
    init.signal = signal;
  }
  const response = await fetch(url, init);
  // Some endpoints (e.g. DELETE emergency-contacts → 205, or 204) reply with an
  // empty body; calling response.json() on it throws "Unexpected end of JSON
  // input". Synthesize an envelope from the HTTP status for those cases.
  const hasBody = response.status !== 204 && response.status !== 205;
  const data = (
    hasBody
      ? await response.json()
      : {
          ok: response.ok,
          status: response.ok ? "success" : "error",
          code: response.status,
          message: response.statusText,
        }
  ) as ApiResponse<unknown>;
  assertCurrentSession();
  const isSuccess = data.ok === true || data.success === true;
  if (
    !isSuccess &&
    data.code === 403 &&
    requireAuth &&
    !preserveSessionOnForbidden
  ) {
    // Token revoked server-side (e.g. password changed elsewhere via
    // tokenVersion bump) — refreshing would fail too, so invalidate the
    // session immediately instead of leaving the UI stuck in a stale
    // "logged in" state that keeps re-hitting 403.
    invalidateSession(sessionAtEntry);
    const sessionAfter = useAuthStore.getState().session;
    if (sessionAfter && sessionAfter.accessToken === "") {
      toast.error("登入狀態已失效，請重新登入");
    }
    throw new ApiError(
      data.message || "Fetch error",
      data.code,
      (data.data as { reason?: string } | undefined)?.reason,
      data.data,
    );
  }
  if (!isSuccess && data.code !== 401) {
    throw new ApiError(
      data.message || "Fetch error",
      data.code,
      (data.data as { reason?: string } | undefined)?.reason,
      data.data,
    );
  }
  if (data.code === 401 && requireAuth && !skipAuthRetry) {
    if (__retried) {
      // Already refreshed + retried once for this original request — stop,
      // don't recurse again, safely invalidate (compare-and-commit against
      // the session captured before this retry) and return the 401 as-is.
      invalidateSession(sessionAtEntry);
      return data;
    }
    const newAccessToken = await refreshAccessToken();
    assertCurrentSession();
    if (newAccessToken) {
      // The coordinator already committed the new token to the store, so
      // the retried call's own `requireAuth` block above will pick it up
      // via `getAccessToken()` and set a fresh Authorization header.
      return fetchRequest(url, {
        method,
        body,
        headers,
        requireAuth,
        isCurrentSession,
        preserveSessionOnForbidden,
        signal,
        ...rest,
        __retried: true,
      } as InternalRequestOptions<T>);
    }
    // null: either a genuine refresh failure (session now `{accessToken:
    // ""}`) or a discard because the identity changed underneath us
    // (logout, or logout-then-relogin) — in the latter case `session` is
    // either null or a different, still-valid session, so stay silent
    // (round7-F1 / "主動登出後不顯示登入已過期 toast").
    const sessionAfter = useAuthStore.getState().session;
    if (sessionAfter && sessionAfter.accessToken === "") {
      toast.error("登入已過期，請重新登入");
    }
  }
  return data;
}
export async function authenticatedRequest<T>(
  url: string,
  options: Omit<RequestOptions<T>, "requireAuth"> = {},
) {
  return fetchRequest(url, { ...options, requireAuth: true });
}

/** Public content is personalized only when an account is signed in. */
export function personalizedRequest<T>(
  url: string,
  options: RequestOptions<T> = {},
) {
  // A request-local epoch includes anonymous sessions and A → B → A changes.
  // Keep this in the transport to avoid importing the safety store into the
  // auth-store → API → transport dependency cycle.
  let accountUnchanged = true;
  const unsubscribe = useAuthStore.subscribe((next, previous) => {
    if (
      next.user?._id !== previous.user?._id ||
      Boolean(next.session?.accessToken) !==
        Boolean(previous.session?.accessToken)
    ) {
      accountUnchanged = false;
    }
  });
  return fetchRequest(url, {
    ...options,
    isCurrentSession: () =>
      accountUnchanged && (options.isCurrentSession?.() ?? true),
    requireAuth: Boolean(useAuthStore.getState().session?.accessToken),
    preserveSessionOnForbidden: true,
  }).finally(unsubscribe);
}
