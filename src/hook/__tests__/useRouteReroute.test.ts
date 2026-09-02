import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/fetch";
import {
  createNavigationGeometryRuntime,
  observeLocalNavigationGeometry,
} from "@/lib/navigation/navigationGeometryRuntime";
import {
  applyRouteReplacement,
  handleVoiceRerouteEvent,
  normalizeRerouteReplacement,
} from "@/lib/navigation/rerouteCoordinator";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { ApiResponse } from "@/types/response";
import type {
  AccessibleRoute,
  AccessibleRouteRerouteData,
  AccessibleRouteRerouteRequest,
  NavInstruction,
} from "@/types/route";
import {
  LocalRerouteController,
  REROUTE_COOLDOWN_MS,
} from "../useRouteReroute";

const oldInstruction: NavInstruction = {
  text: "沿舊路線直行",
  type: "turn",
  bearing: null,
  relativeDirection: null,
  distanceM: 100,
  streetName: null,
  legType: "WALK",
  polylineIndex: 0,
};

const newInstruction: NavInstruction = {
  ...oldInstruction,
  text: "沿新路線右轉",
  distanceM: 80,
};

function route(version: number, token: string): AccessibleRoute {
  const startLng = 121.56 + version / 100;
  return {
    routeId: `route-v${version}`,
    navigationId: "nav-1",
    routeVersion: version,
    routeToken: token,
    routeName: `route ${version}`,
    totalMinutes: 10,
    transferCount: 0,
    legs: [
      {
        type: "WALK",
        from: "起點",
        to: "終點",
        distanceM: 100,
        minutesEst: 2,
        polyline: [
          [startLng, 25.03],
          [startLng + 0.001, 25.031],
        ],
        a11yFacilities: [],
      },
    ],
    accessibilityHighlights: [],
  };
}

function response(version = 2): AccessibleRouteRerouteData {
  return {
    navigationId: "nav-1",
    previousRouteVersion: version - 1,
    routeVersion: version,
    routeToken: `token-v${version}`,
    route: route(version, `ignored-token-v${version}`),
    instructions: [newInstruction],
    warnings: ["new warning"],
    currentStepIndex: 0,
    replayed: false,
  };
}

function seedOldRuntime() {
  const oldRoute = route(1, "token-v1");
  useMapStore.setState({
    userLocation: { lat: 25.033, lng: 121.565 },
    selectRoute: { index: 0, route: oldRoute },
    computeRoutes: [oldRoute],
  });
  useNavStore.setState({
    navigationSource: "local",
    navigationId: "nav-1",
    routeVersion: 1,
    instructions: [oldInstruction],
    warnings: ["old warning"],
    currentStepIndex: 0,
    distanceToNextM: 45,
    remainingM: 500,
    routeTotalM: 600,
    isOffRoute: true,
    rerouteStatus: "idle",
    rerouteError: null,
    rerouteRetryable: false,
  });
}

function controller(
  post: (
    request: AccessibleRouteRerouteRequest,
  ) => Promise<ApiResponse<AccessibleRouteRerouteData>>,
  now = () => 100_000,
) {
  return new LocalRerouteController({
    readContext: () => {
      const map = useMapStore.getState();
      const nav = useNavStore.getState();
      return {
        navigationSource: nav.navigationSource,
        navigationId: nav.navigationId,
        routeToken: map.selectRoute?.route.routeToken ?? null,
        routeVersion: nav.routeVersion,
        position: map.userLocation,
      };
    },
    post,
    apply: (data) => applyRouteReplacement(normalizeRerouteReplacement(data)),
    setPending: () => useNavStore.getState().setReroutePending(),
    setError: (message) => useNavStore.getState().setRerouteError(message),
    now,
    createRequestId: () => "73e27df0-f3fa-4bf2-9320-da6bcb83d51a",
  });
}

afterEach(() => {
  useNavStore.getState().reset();
  useMapStore.setState({
    userLocation: null,
    selectRoute: null,
    computeRoutes: null,
  });
  vi.restoreAllMocks();
});

describe("LocalRerouteController", () => {
  it("sends exactly one local POST for a confirmed off-route episode", async () => {
    seedOldRuntime();
    const post = vi.fn(async () => ({
      ok: true,
      status: "success" as const,
      code: 200,
      message: "ok",
      data: response(),
    }));
    const reroute = controller(post);

    const first = reroute.confirmOffRouteEpisode();
    const duplicate = reroute.confirmOffRouteEpisode();
    await expect(first).resolves.toBe(true);
    await expect(duplicate).resolves.toBe(false);

    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        routeToken: "token-v1",
        previousRouteVersion: 1,
        reason: "OFF_ROUTE",
      }),
    );
  });

  it("uses an in-flight guard and retains the old route/runtime while pending", async () => {
    seedOldRuntime();
    let resolve!: (value: ReturnType<typeof successfulEnvelope>) => void;
    const post = vi.fn(
      () =>
        new Promise<ReturnType<typeof successfulEnvelope>>((done) => {
          resolve = done;
        }),
    );
    const reroute = controller(post);

    const pending = reroute.confirmOffRouteEpisode();
    await reroute.retry();

    expect(post).toHaveBeenCalledTimes(1);
    expect(useMapStore.getState().selectRoute?.route.routeId).toBe("route-v1");
    expect(useNavStore.getState()).toMatchObject({
      instructions: [oldInstruction],
      remainingM: 500,
      rerouteStatus: "pending",
    });

    resolve(successfulEnvelope());
    await pending;
  });

  it("never POSTs when voice owns navigation", async () => {
    seedOldRuntime();
    useNavStore.setState({ navigationSource: "voice" });
    const post = vi.fn();

    await expect(controller(post).confirmOffRouteEpisode()).resolves.toBe(
      false,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("ignores a delayed local response after navigationId changes", async () => {
    seedOldRuntime();
    let resolve!: (value: ReturnType<typeof successfulEnvelope>) => void;
    const post = vi.fn(
      () =>
        new Promise<ReturnType<typeof successfulEnvelope>>((done) => {
          resolve = done;
        }),
    );
    const pending = controller(post).confirmOffRouteEpisode();

    const nextRoute = {
      ...route(1, "token-next"),
      navigationId: "nav-2",
      routeId: "route-next",
    };
    useMapStore.setState({
      selectRoute: { index: 0, route: nextRoute },
      computeRoutes: [nextRoute],
    });
    useNavStore.setState({
      navigationId: "nav-2",
      routeVersion: 1,
      rerouteStatus: "idle",
      rerouteError: null,
    });

    resolve(successfulEnvelope());
    await expect(pending).resolves.toBe(false);
    expect(useMapStore.getState().selectRoute?.route.routeId).toBe(
      "route-next",
    );
    expect(useNavStore.getState()).toMatchObject({
      navigationId: "nav-2",
      routeVersion: 1,
      rerouteStatus: "idle",
      rerouteError: null,
    });
  });

  it("ignores a delayed local response after ownership switches to voice", async () => {
    seedOldRuntime();
    let resolve!: (value: ReturnType<typeof successfulEnvelope>) => void;
    const post = vi.fn(
      () =>
        new Promise<ReturnType<typeof successfulEnvelope>>((done) => {
          resolve = done;
        }),
    );
    const pending = controller(post).confirmOffRouteEpisode();
    useNavStore.setState({
      navigationSource: "voice",
      rerouteStatus: "pending",
      rerouteError: null,
    });

    resolve(successfulEnvelope());
    await expect(pending).resolves.toBe(false);
    expect(useMapStore.getState().selectRoute?.route.routeId).toBe("route-v1");
    expect(useNavStore.getState()).toMatchObject({
      navigationSource: "voice",
      routeVersion: 1,
      rerouteStatus: "pending",
      rerouteError: null,
    });
  });

  it("enforces the 30-second automatic cooldown across episodes", async () => {
    seedOldRuntime();
    let now = 100_000;
    const post = vi.fn(async () => successfulEnvelope());
    const reroute = controller(post, () => now);

    await reroute.confirmOffRouteEpisode();
    reroute.clearOffRouteEpisode();
    now += REROUTE_COOLDOWN_MS - 1;
    await reroute.confirmOffRouteEpisode();
    expect(post).toHaveBeenCalledTimes(1);

    reroute.clearOffRouteEpisode();
    now += 1;
    await reroute.confirmOffRouteEpisode();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it.each([409, 410, 422, 503])(
    "keeps the old route/runtime and exposes retry for HTTP %i",
    async (code) => {
      seedOldRuntime();
      const post = vi.fn(async () => {
        throw new ApiError(`reroute failed ${code}`, code);
      });

      await controller(post).confirmOffRouteEpisode();

      expect(useMapStore.getState().selectRoute?.route.routeId).toBe(
        "route-v1",
      );
      expect(useNavStore.getState()).toMatchObject({
        instructions: [oldInstruction],
        currentStepIndex: 0,
        remainingM: 500,
        rerouteStatus: "error",
        rerouteError: `reroute failed ${code}`,
        rerouteRetryable: true,
      });
    },
  );

  it("keeps the old route/runtime and exposes retry on network failure", async () => {
    seedOldRuntime();
    const post = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });

    await controller(post).confirmOffRouteEpisode();

    expect(useMapStore.getState().selectRoute?.route.routeId).toBe("route-v1");
    expect(useNavStore.getState()).toMatchObject({
      instructions: [oldInstruction],
      remainingM: 500,
      rerouteStatus: "error",
      rerouteError: "Failed to fetch",
      rerouteRetryable: true,
    });
  });

  it("cancels in-flight response after clearOffRouteEpisode is called", async () => {
    seedOldRuntime();
    let resolve!: (value: ReturnType<typeof successfulEnvelope>) => void;
    const post = vi.fn(
      () =>
        new Promise<ReturnType<typeof successfulEnvelope>>((done) => {
          resolve = done;
        }),
    );
    const reroute = controller(post);

    const pending = reroute.confirmOffRouteEpisode();
    expect(useNavStore.getState().rerouteStatus).toBe("pending");

    reroute.clearOffRouteEpisode();
    resolve(successfulEnvelope());

    await expect(pending).resolves.toBe(false);
    expect(useMapStore.getState().selectRoute?.route.routeId).toBe("route-v1");
  });

  it("reuses the same clientRequestId when retrying in the same episode", async () => {
    seedOldRuntime();
    let idCounter = 1;
    const post = vi.fn()
      .mockRejectedValueOnce(new ApiError("503 unavailable", 503))
      .mockResolvedValueOnce(successfulEnvelope());

    const reroute = new LocalRerouteController({
      readContext: () => {
        const map = useMapStore.getState();
        const nav = useNavStore.getState();
        return {
          navigationSource: nav.navigationSource,
          navigationId: nav.navigationId,
          routeToken: map.selectRoute?.route.routeToken ?? null,
          routeVersion: nav.routeVersion,
          position: map.userLocation,
        };
      },
      post,
      apply: (data) => applyRouteReplacement(normalizeRerouteReplacement(data)),
      setPending: () => useNavStore.getState().setReroutePending(),
      setError: (message) => useNavStore.getState().setRerouteError(message),
      createRequestId: () => `req-id-${idCounter++}`,
    });

    await reroute.confirmOffRouteEpisode();
    expect(post).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ clientRequestId: "req-id-1", reason: "OFF_ROUTE" }),
    );

    await reroute.retry();
    expect(post).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ clientRequestId: "req-id-1", reason: "MANUAL" }),
    );
  });
});

function successfulEnvelope() {
  return {
    ok: true,
    status: "success" as const,
    code: 200,
    message: "ok",
    data: response(),
  };
}

describe("route replacement coordinator", () => {
  it("rejects a higher-version replacement for another navigationId", () => {
    seedOldRuntime();
    const stale = {
      ...normalizeRerouteReplacement(response()),
      navigationId: "nav-old",
    };

    expect(applyRouteReplacement(stale)).toBe(false);
    expect(useMapStore.getState().selectRoute?.route.routeId).toBe("route-v1");
    expect(useNavStore.getState()).toMatchObject({
      navigationId: "nav-1",
      routeVersion: 1,
      rerouteStatus: "idle",
      instructions: [oldInstruction],
    });
  });

  it("ignores a stale response without changing route or runtime", () => {
    seedOldRuntime();
    useNavStore.setState({ routeVersion: 2 });

    expect(
      applyRouteReplacement(normalizeRerouteReplacement(response(2))),
    ).toBe(false);
    expect(useMapStore.getState().selectRoute?.route.routeId).toBe("route-v1");
    expect(useNavStore.getState()).toMatchObject({
      instructions: [oldInstruction],
      remainingM: 500,
    });
  });

  it("ignores a replacement whose previousRouteVersion does not match the current route", () => {
    seedOldRuntime();
    useNavStore.getState().setReroutePending();
    const wrongBase = normalizeRerouteReplacement({
      ...response(2),
      previousRouteVersion: 0,
    });

    expect(applyRouteReplacement(wrongBase)).toBe(false);
    expect(useMapStore.getState().selectRoute?.route.routeId).toBe("route-v1");
    expect(useNavStore.getState()).toMatchObject({
      navigationId: "nav-1",
      routeVersion: 1,
      instructions: [oldInstruction],
      remainingM: 500,
      isOffRoute: true,
      rerouteStatus: "pending",
    });
  });

  it("ignores a skipped routeVersion without changing route or runtime", () => {
    seedOldRuntime();
    useNavStore.getState().setReroutePending();

    const skippedVersion = normalizeRerouteReplacement({
      ...response(3),
      previousRouteVersion: 1,
    });

    expect(applyRouteReplacement(skippedVersion)).toBe(false);
    expect(useMapStore.getState().selectRoute?.route.routeId).toBe("route-v1");
    expect(useNavStore.getState()).toMatchObject({
      navigationId: "nav-1",
      routeVersion: 1,
      instructions: [oldInstruction],
      remainingM: 500,
      isOffRoute: true,
      rerouteStatus: "pending",
    });
  });

  it("atomically applies a valid v1 to v2 replacement", () => {
    seedOldRuntime();
    const replacement = normalizeRerouteReplacement(response());

    expect(replacement.previousRouteVersion).toBe(1);
    expect(applyRouteReplacement(replacement)).toBe(true);

    expect(useMapStore.getState().selectRoute).toMatchObject({
      index: 0,
      route: {
        routeId: "route-v2",
        navigationId: "nav-1",
        routeVersion: 2,
        routeToken: "token-v2",
      },
    });
    expect(useMapStore.getState().computeRoutes?.[0]?.routeId).toBe("route-v2");
    expect(useNavStore.getState()).toMatchObject({
      navigationId: "nav-1",
      routeVersion: 2,
      instructions: [newInstruction],
      warnings: ["new warning"],
      currentStepIndex: 0,
      distanceToNextM: 80,
      remainingM: 80,
      routeTotalM: 80,
      isOffRoute: false,
      rerouteStatus: "idle",
      rerouteError: null,
    });
  });

  it("refreshes local geometry synchronously with replacement stores", () => {
    seedOldRuntime();
    const runtime = createNavigationGeometryRuntime();
    const stopObserving = observeLocalNavigationGeometry(runtime);
    expect(runtime.path?.path[0]?.lng).toBeCloseTo(121.57);

    expect(applyRouteReplacement(normalizeRerouteReplacement(response()))).toBe(
      true,
    );

    expect(runtime.path?.path[0]?.lng).toBeCloseTo(121.58);
    expect(runtime.waypoints[0]?.coord?.lng).toBeCloseTo(121.58);
    stopObserving();
  });

  it("handles voice pending, replacement, and failure without any HTTP call", () => {
    seedOldRuntime();
    useNavStore.setState({ navigationSource: "voice" });
    const post = vi.fn();

    handleVoiceRerouteEvent({
      type: "nav.rerouting",
      navigationId: "nav-1",
      previousRouteVersion: 1,
    });
    expect(useNavStore.getState().rerouteStatus).toBe("pending");
    expect(useMapStore.getState().selectRoute?.route.routeId).toBe("route-v1");

    handleVoiceRerouteEvent({
      type: "nav.route_replaced",
      replacement: normalizeRerouteReplacement(response()),
    });
    expect(useMapStore.getState().selectRoute?.route.routeId).toBe("route-v2");

    handleVoiceRerouteEvent({
      type: "nav.reroute_failed",
      navigationId: "nav-1",
      previousRouteVersion: 2,
      message: "planner unavailable",
      retryable: true,
    });
    expect(useMapStore.getState().selectRoute?.route.routeId).toBe("route-v2");
    expect(useNavStore.getState()).toMatchObject({
      rerouteStatus: "error",
      rerouteError: "planner unavailable",
      rerouteRetryable: true,
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("ignores stale voice pending and failure events without changing UI", () => {
    seedOldRuntime();
    useNavStore.setState({ navigationSource: "voice" });

    expect(
      handleVoiceRerouteEvent({
        type: "nav.rerouting",
        navigationId: "nav-old",
        previousRouteVersion: 1,
      }),
    ).toBe(false);
    expect(useNavStore.getState()).toMatchObject({
      rerouteStatus: "idle",
      rerouteError: null,
    });

    useNavStore.getState().setReroutePending();
    expect(
      handleVoiceRerouteEvent({
        type: "nav.reroute_failed",
        navigationId: "nav-1",
        previousRouteVersion: 0,
        message: "stale failure",
        retryable: true,
      }),
    ).toBe(false);
    expect(useNavStore.getState()).toMatchObject({
      rerouteStatus: "pending",
      rerouteError: null,
      rerouteRetryable: false,
    });
  });

  it("rejects route replacement and voice reroute events when arrived is true", () => {
    seedOldRuntime();
    useNavStore.setState({ arrived: true, navigationSource: "voice" });

    expect(applyRouteReplacement(normalizeRerouteReplacement(response()))).toBe(
      false,
    );
    expect(
      handleVoiceRerouteEvent({
        type: "nav.route_replaced",
        replacement: normalizeRerouteReplacement(response()),
      }),
    ).toBe(false);
    expect(useMapStore.getState().selectRoute?.route.routeId).toBe("route-v1");
  });

  it("resets reroute error and status when setInstructions is called", () => {
    seedOldRuntime();
    useNavStore.getState().setRerouteError("previous error", true);
    expect(useNavStore.getState().rerouteStatus).toBe("error");

    useNavStore.getState().setInstructions([newInstruction]);
    expect(useNavStore.getState()).toMatchObject({
      rerouteStatus: "idle",
      rerouteError: null,
      rerouteRetryable: false,
    });
  });
});
