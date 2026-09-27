import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthStatePort } from "@/lib/authRefresh";
import {
  configureAuthState,
  invalidateSession,
  refreshAccessToken,
} from "@/lib/authRefresh";
import { END_POINT } from "@/lib/config";
import { fetchRequest } from "@/lib/fetch";
import useAuthStore from "@/stores/useAuthStore";
import type { ApiResponse } from "@/types/response";
import type { UserDTO } from "@/types/user";

// Importing `useAuthStore` triggers its module-level `configureAuthState(...)`
// registration (plan §4 useAuthStore.ts row), so these tests exercise the
// real single-flight coordinator wired to a real zustand store — no store
// mocking, per the plan's "以真實 zustand store 於 node 執行" requirement.

function makeUser(id: string): UserDTO {
  return {
    _id: id,
    name: id,
    email: `${id}@test.dev`,
    client_id: id,
    authProviders: ["google"],
    emailVerified: true,
    tokenVersion: 0,
  };
}

function resetStore() {
  useAuthStore.setState({ user: null, session: null });
}

function jsonResponse(body: unknown): Response {
  return { json: async () => body } as Response;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function makeDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Drain a generous number of microtask turns so chained `await`s that don't
 * depend on timers get a chance to run to their next await point. */
async function flush() {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve();
  }
}

type FetchInit = RequestInit | undefined;

function stubFetch(handlers: {
  refresh?: (init: FetchInit) => Response | Promise<Response>;
  logout?: (init: FetchInit) => Response | Promise<Response>;
  endpoint?: (url: string, init: FetchInit) => Response | Promise<Response>;
}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/api/v1/user/refresh")) {
      if (!handlers.refresh) {
        throw new Error("unexpected refresh call");
      }
      return handlers.refresh(init);
    }
    if (url.includes("/api/v1/user/logout")) {
      return handlers.logout
        ? handlers.logout(init)
        : jsonResponse({ ok: true });
    }
    if (handlers.endpoint) {
      return handlers.endpoint(url, init);
    }
    throw new Error(`unexpected fetch url: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function realPort(): AuthStatePort {
  return {
    getSession: () => useAuthStore.getState().session,
    setSession: (session) => useAuthStore.getState().setSession(session),
    setUser: (user) => useAuthStore.getState().setUser(user),
  };
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("authRefresh single-flight (case 19)", () => {
  it("calls the refresh endpoint exactly once for N concurrent callers, all resolve the same token, store committed once", async () => {
    useAuthStore.setState({
      user: makeUser("u1"),
      session: { accessToken: "old" },
    });
    const fetchMock = stubFetch({
      refresh: (init) => {
        expect(init?.method).toBe("POST");
        expect(init?.credentials).toBe("include");
        return jsonResponse({ ok: true, accessToken: "new-token" });
      },
    });

    const results = await Promise.all([
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ]);

    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/v1/user/refresh"),
    );
    expect(refreshCalls).toHaveLength(1);
    expect(String(refreshCalls[0][0])).toBe(`${END_POINT}/api/v1/user/refresh`);
    expect(results).toEqual(["new-token", "new-token", "new-token"]);
    expect(useAuthStore.getState().session).toEqual({
      accessToken: "new-token",
    });
    expect(useAuthStore.getState().user).toEqual(makeUser("u1"));
  });

  it("on failure clears accessToken and user; never leaves user=null with a non-empty token", async () => {
    useAuthStore.setState({
      user: makeUser("u1"),
      session: { accessToken: "old" },
    });
    stubFetch({ refresh: () => jsonResponse({ ok: false, code: 401 }) });

    const result = await refreshAccessToken();

    expect(result).toBeNull();
    expect(useAuthStore.getState().session).toEqual({ accessToken: "" });
    expect(useAuthStore.getState().user).toBeNull();
  });
});

describe("useAuthStore logout race (case 20)", () => {
  const logoutSettlements = [
    { name: "logout still pending", settle: (_d: Deferred<Response>) => {} },
    {
      name: "logout resolves",
      settle: (d: Deferred<Response>) => d.resolve(jsonResponse({ ok: true })),
    },
    {
      name: "logout rejects",
      settle: (d: Deferred<Response>) => d.reject(new Error("network down")),
    },
  ];
  const refreshOutcomes = ["success", "failure"] as const;

  for (const scenario of logoutSettlements) {
    for (const outcome of refreshOutcomes) {
      it(`${scenario.name} + refresh ${outcome} -> session stays null, not revived`, async () => {
        useAuthStore.setState({
          user: makeUser("u1"),
          session: { accessToken: "old" },
        });
        const refreshDeferred = makeDeferred<Response>();
        const logoutDeferred = makeDeferred<Response>();
        stubFetch({
          refresh: () => refreshDeferred.promise,
          logout: () => logoutDeferred.promise,
        });

        const refreshPromise = refreshAccessToken();
        await flush();

        useAuthStore.getState().logout();
        expect(useAuthStore.getState().session).toBeNull();
        expect(useAuthStore.getState().user).toBeNull();

        scenario.settle(logoutDeferred);
        if (outcome === "success") {
          refreshDeferred.resolve(
            jsonResponse({ ok: true, accessToken: "new-token" }),
          );
        } else {
          refreshDeferred.resolve(jsonResponse({ ok: false, code: 401 }));
        }

        const result = await refreshPromise;
        await flush();

        expect(result).toBeNull();
        expect(useAuthStore.getState().session).toBeNull();
        expect(useAuthStore.getState().user).toBeNull();
      });
    }
  }

  it("opens a fresh lane on the next call after a discarded logout race", async () => {
    useAuthStore.setState({
      user: makeUser("u1"),
      session: { accessToken: "old" },
    });
    const refreshDeferred = makeDeferred<Response>();
    stubFetch({ refresh: () => refreshDeferred.promise });

    const first = refreshAccessToken();
    await flush();
    useAuthStore.getState().logout();
    refreshDeferred.resolve(jsonResponse({ ok: true, accessToken: "stale" }));
    expect(await first).toBeNull();

    // New identity, new lane, fresh transport call.
    const bSession = { accessToken: "B-token" };
    useAuthStore.setState({ user: makeUser("B"), session: bSession });
    stubFetch({
      refresh: () => jsonResponse({ ok: true, accessToken: "B-new" }),
    });
    const second = await refreshAccessToken();
    expect(second).toBe("B-new");
  });
});

describe("useAuthStore.logout synchronization (case 20b)", () => {
  it("clears user/session synchronously, revokes via cookie-only raw fetch, never touches the refresh transport", async () => {
    useAuthStore.setState({
      user: makeUser("u1"),
      session: { accessToken: "old-token" },
    });
    let capturedAuthHeader: string | undefined;
    let capturedCredentials: RequestCredentials | undefined;
    const fetchMock = stubFetch({
      logout: (init) => {
        capturedAuthHeader = (
          init?.headers as Record<string, string> | undefined
        )?.Authorization;
        capturedCredentials = init?.credentials;
        return jsonResponse({ ok: true });
      },
    });

    useAuthStore.getState().logout();

    // Not awaited: state must already be cleared synchronously.
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().session).toBeNull();

    await flush();

    expect(capturedAuthHeader).toBeUndefined();
    expect(capturedCredentials).toBe("include");
    const refreshCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/v1/user/refresh"),
    );
    expect(refreshCalls).toHaveLength(0);
  });

  it("does not throw when revoke rejects; state stays cleared", async () => {
    useAuthStore.setState({
      user: makeUser("u1"),
      session: { accessToken: "old-token" },
    });
    stubFetch({
      logout: () => Promise.reject(new Error("network down")),
    });

    expect(() => useAuthStore.getState().logout()).not.toThrow();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().session).toBeNull();

    await flush();

    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().session).toBeNull();
  });
});

describe("fetch 401 integration (case 23)", () => {
  it("shares one lane with a concurrent direct caller, transport called once, retry carries the new Authorization", async () => {
    useAuthStore.setState({
      user: makeUser("u1"),
      session: { accessToken: "old-token" },
    });
    const refreshDeferred = makeDeferred<Response>();
    const endpointDeferred1 = makeDeferred<Response>();
    const endpointDeferred2 = makeDeferred<Response>();
    let refreshCalls = 0;
    let endpointCallCount = 0;
    const endpointAuthHeaders: (string | undefined)[] = [];

    stubFetch({
      refresh: () => {
        refreshCalls++;
        return refreshDeferred.promise;
      },
      endpoint: (_url, init) => {
        endpointCallCount++;
        endpointAuthHeaders.push(
          (init?.headers as Record<string, string> | undefined)?.Authorization,
        );
        return endpointCallCount === 1
          ? endpointDeferred1.promise
          : endpointDeferred2.promise;
      },
    });

    const directRefreshCall = refreshAccessToken();
    await flush();
    expect(refreshCalls).toBe(1); // lane created by the direct caller

    const fetchResultPromise = fetchRequest(`${END_POINT}/some-endpoint`, {
      requireAuth: true,
    });
    await flush();
    endpointDeferred1.resolve(jsonResponse({ ok: false, code: 401 }));
    await flush();

    expect(refreshCalls).toBe(1); // fetch.ts joined the existing lane, no 2nd transport call

    refreshDeferred.resolve(
      jsonResponse({ ok: true, accessToken: "new-token" }),
    );
    await flush();
    endpointDeferred2.resolve(jsonResponse({ ok: true, data: "result" }));

    const [directResult, result] = await Promise.all([
      directRefreshCall,
      fetchResultPromise,
    ]);

    expect(refreshCalls).toBe(1);
    expect(directResult).toBe("new-token");
    expect(endpointCallCount).toBe(2);
    expect(endpointAuthHeaders[0]).toBe("Bearer old-token");
    expect(endpointAuthHeaders[1]).toBe("Bearer new-token");
    expect((result as ApiResponse<{ data: string }>).data).toBe("result");
  });
});

describe("no retry after a logout-discarded refresh (case 24)", () => {
  it("resolves null and does not retry when refreshAccessToken discards due to a concurrent logout", async () => {
    useAuthStore.setState({
      user: makeUser("u1"),
      session: { accessToken: "old-token" },
    });
    const refreshDeferred = makeDeferred<Response>();
    let endpointCalls = 0;
    stubFetch({
      refresh: () => refreshDeferred.promise,
      endpoint: () => {
        endpointCalls++;
        return jsonResponse({ ok: false, code: 401 });
      },
    });

    const fetchResultPromise = fetchRequest(`${END_POINT}/some-endpoint`, {
      requireAuth: true,
    });
    await flush();
    useAuthStore.getState().logout();
    refreshDeferred.resolve(
      jsonResponse({ ok: true, accessToken: "new-token" }),
    );

    const result = await fetchResultPromise;

    expect(endpointCalls).toBe(1); // never retried
    expect(useAuthStore.getState().session).toBeNull();
    expect((result as ApiResponse<unknown>).code).toBe(401);
  });
});

describe("ABA relogin race (case 25)", () => {
  it("does not commit a stale refresh success onto a newly logged-in session", async () => {
    useAuthStore.setState({
      user: makeUser("A"),
      session: { accessToken: "A-token" },
    });
    const refreshDeferred = makeDeferred<Response>();
    stubFetch({ refresh: () => refreshDeferred.promise });

    const stalePromise = refreshAccessToken();
    await flush();

    useAuthStore.getState().logout();
    const bSession = { accessToken: "B-token" };
    useAuthStore.setState({ user: makeUser("B"), session: bSession });

    refreshDeferred.resolve(
      jsonResponse({ ok: true, accessToken: "stale-new-token" }),
    );
    const staleResult = await stalePromise;

    expect(staleResult).toBeNull();
    expect(useAuthStore.getState().session).toBe(bSession);
    expect(useAuthStore.getState().user).toEqual(makeUser("B"));
  });

  it("does not invalidate a newly logged-in session when the stale refresh fails", async () => {
    useAuthStore.setState({
      user: makeUser("A"),
      session: { accessToken: "A-token" },
    });
    const refreshDeferred = makeDeferred<Response>();
    stubFetch({ refresh: () => refreshDeferred.promise });

    const stalePromise = refreshAccessToken();
    await flush();

    useAuthStore.getState().logout();
    const bSession = { accessToken: "B-token" };
    useAuthStore.setState({ user: makeUser("B"), session: bSession });

    refreshDeferred.resolve(jsonResponse({ ok: false, code: 401 }));
    const staleResult = await stalePromise;

    expect(staleResult).toBeNull();
    expect(useAuthStore.getState().session).toBe(bSession);
    expect(useAuthStore.getState().user).toEqual(makeUser("B"));
  });
});

describe("retry-still-401 does not recurse (case 27)", () => {
  it("refreshes once, retries once, invalidates via compare-and-commit, and returns the 401 as-is", async () => {
    useAuthStore.setState({
      user: makeUser("u1"),
      session: { accessToken: "old-token" },
    });
    let refreshCalls = 0;
    let endpointCalls = 0;
    stubFetch({
      refresh: () => {
        refreshCalls++;
        return jsonResponse({ ok: true, accessToken: "new-token" });
      },
      endpoint: () => {
        endpointCalls++;
        return jsonResponse({ ok: false, code: 401 });
      },
    });

    const result = await fetchRequest(`${END_POINT}/some-endpoint`, {
      requireAuth: true,
    });

    expect(refreshCalls).toBe(1);
    expect(endpointCalls).toBe(2);
    expect(useAuthStore.getState().session).toEqual({ accessToken: "" });
    expect(useAuthStore.getState().user).toBeNull();
    expect((result as ApiResponse<unknown>).code).toBe(401);
  });

  it("does not clear a session that was replaced during the retry window", async () => {
    useAuthStore.setState({
      user: makeUser("u1"),
      session: { accessToken: "old-token" },
    });
    const endpointDeferred2 = makeDeferred<Response>();
    let endpointCalls = 0;
    let replaced: { accessToken: string } | null = null;
    stubFetch({
      refresh: () => jsonResponse({ ok: true, accessToken: "new-token" }),
      endpoint: () => {
        endpointCalls++;
        if (endpointCalls === 1) {
          return jsonResponse({ ok: false, code: 401 });
        }
        replaced = { accessToken: "replaced-token" };
        useAuthStore.setState({ session: replaced });
        return endpointDeferred2.promise;
      },
    });

    const resultPromise = fetchRequest(`${END_POINT}/some-endpoint`, {
      requireAuth: true,
    });
    await flush();
    endpointDeferred2.resolve(jsonResponse({ ok: false, code: 401 }));
    await resultPromise;

    expect(useAuthStore.getState().session).toBe(replaced);
  });
});

describe("cross-identity lane isolation & reentrant merge (case 28)", () => {
  it("merges N (>=3) new-identity callers into exactly one new lane once the stale lane settles", async () => {
    useAuthStore.setState({
      user: makeUser("A"),
      session: { accessToken: "A-token" },
    });
    const refreshADeferred = makeDeferred<Response>();
    const refreshBDeferred = makeDeferred<Response>();
    let refreshCallCount = 0;
    stubFetch({
      refresh: () => {
        refreshCallCount++;
        return refreshCallCount === 1
          ? refreshADeferred.promise
          : refreshBDeferred.promise;
      },
    });

    const aPromise = refreshAccessToken();
    await flush();

    useAuthStore.getState().logout();
    useAuthStore.setState({
      user: makeUser("B"),
      session: { accessToken: "B-token" },
    });

    const bCallers = [
      refreshAccessToken(),
      refreshAccessToken(),
      refreshAccessToken(),
    ];
    await flush();
    expect(refreshCallCount).toBe(1); // B callers still queued behind A

    refreshADeferred.resolve(
      jsonResponse({ ok: true, accessToken: "stale-A-new-token" }),
    );
    await flush();
    expect(refreshCallCount).toBe(2); // exactly one B lane created on reentry

    refreshBDeferred.resolve(
      jsonResponse({ ok: true, accessToken: "B-new-token" }),
    );

    const [aResult, ...bResults] = await Promise.all([aPromise, ...bCallers]);

    expect(refreshCallCount).toBe(2);
    expect(aResult).toBeNull();
    expect(bResults).toEqual(["B-new-token", "B-new-token", "B-new-token"]);
    expect(useAuthStore.getState().session).toEqual({
      accessToken: "B-new-token",
    });
  });

  it("discards a B lane and merges into a single C lane when identity changes again while B waits", async () => {
    useAuthStore.setState({
      user: makeUser("A"),
      session: { accessToken: "A-token" },
    });
    const refreshADeferred = makeDeferred<Response>();
    const refreshBDeferred = makeDeferred<Response>();
    const refreshCDeferred = makeDeferred<Response>();
    let refreshCallCount = 0;
    stubFetch({
      refresh: () => {
        refreshCallCount++;
        if (refreshCallCount === 1) return refreshADeferred.promise;
        if (refreshCallCount === 2) return refreshBDeferred.promise;
        return refreshCDeferred.promise;
      },
    });

    const aPromise = refreshAccessToken();
    await flush();
    useAuthStore.getState().logout();
    useAuthStore.setState({
      user: makeUser("B"),
      session: { accessToken: "B-token" },
    });

    const bPromise = refreshAccessToken();
    refreshADeferred.resolve(jsonResponse({ ok: true, accessToken: "stale" }));
    await flush();
    expect(refreshCallCount).toBe(2); // B lane created

    useAuthStore.getState().logout();
    useAuthStore.setState({
      user: makeUser("C"),
      session: { accessToken: "C-token" },
    });

    const cCallers = [refreshAccessToken(), refreshAccessToken()];
    await flush();
    expect(refreshCallCount).toBe(2); // C callers still queued behind B

    refreshBDeferred.resolve(
      jsonResponse({ ok: true, accessToken: "stale-B" }),
    );
    await flush();
    expect(refreshCallCount).toBe(3); // single C lane created on reentry

    refreshCDeferred.resolve(
      jsonResponse({ ok: true, accessToken: "C-new-token" }),
    );

    const [aResult, bResult, ...cResults] = await Promise.all([
      aPromise,
      bPromise,
      ...cCallers,
    ]);

    expect(aResult).toBeNull();
    expect(bResult).toBeNull();
    expect(cResults).toEqual(["C-new-token", "C-new-token"]);
    expect(useAuthStore.getState().session).toEqual({
      accessToken: "C-new-token",
    });
  });

  it("resolves null without throwing when the auth-state port has not been configured", async () => {
    configureAuthState(undefined as unknown as AuthStatePort);
    try {
      await expect(refreshAccessToken()).resolves.toBeNull();
    } finally {
      configureAuthState(realPort());
    }
  });
});

describe("invalidateSession compare-and-invalidate", () => {
  it("clears state only when the passed reference still matches the current session", () => {
    const session = { accessToken: "token" };
    useAuthStore.setState({ user: makeUser("u1"), session });

    invalidateSession({ accessToken: "different-object-same-shape" });
    expect(useAuthStore.getState().session).toBe(session);

    invalidateSession(session);
    expect(useAuthStore.getState().session).toEqual({ accessToken: "" });
    expect(useAuthStore.getState().user).toBeNull();
  });
});
