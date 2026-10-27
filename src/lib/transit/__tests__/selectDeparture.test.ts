import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectBusDeparture } from "@/lib/api/a11y";
import { startNavigation } from "@/lib/navigation/navigationLifecycle";
import { busLegKey } from "@/lib/transit/busLegStops";
import { adoptBusDeparture } from "@/lib/transit/selectDeparture";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute } from "@/types/route";
import { departureCandidates } from "./fixtures/departureCandidates";

vi.mock("@/lib/api/a11y", () => ({
  selectBusDeparture: vi.fn(),
  rerouteAccessibleRoute: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

const route = (token: string): AccessibleRoute => ({
  routeId: token,
  routeToken: token,
  navigationId: `navigation-${token}`,
  routeVersion: 1,
  routeName: token,
  totalMinutes: 24,
  transferCount: 0,
  accessibilityHighlights: [],
  legs: [
    {
      type: "BUS",
      routeName: "82",
      departureStop: "A",
      arrivalStop: "B",
      direction: 0,
      estimatedWaitMinutes: 4,
      waitInfo: { source: "schedule", time: "00:00" },
      polyline: [
        [121, 25],
        [121.01, 25.01],
      ],
      departureStopA11y: [],
      arrivalStopA11y: [],
      selectedDeparture: departureCandidates[1],
    },
  ],
});
const success = (token: string) => ({
  ok: true,
  code: 200,
  status: "success" as const,
  message: "OK",
  data: { route: route(token) },
});
function deferred() {
  let resolve!: (value: ReturnType<typeof success>) => void;
  const promise = new Promise<ReturnType<typeof success>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  useMapStore.setState(useMapStore.getInitialState());
  useNavStore.getState().reset();
  const initial = route("old");
  useMapStore.setState({
    computeRoutes: [initial],
    selectRoute: { index: 0, route: initial },
  });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("adopting a departure", () => {
  it.each([false, true])(
    "keeps expanded stops on the new departure unless the user closes them while confirming (%s)",
    async (closeWhilePending) => {
      const previous = useMapStore.getState().selectRoute?.route.legs[0];
      if (previous?.type !== "BUS") throw new Error("fixture");
      const openLeg = {
        ...previous,
        planContext: { routeToken: "old", legIndex: 0 },
      };
      useMapStore.setState({
        activeBusLeg: { key: busLegKey("0:0", openLeg), leg: openLeg },
      });
      const request = deferred();
      vi.mocked(selectBusDeparture).mockReturnValueOnce(request.promise);
      const selection = adoptBusDeparture("old", 0, "chosen-82");
      if (closeWhilePending) useMapStore.getState().setActiveBusLeg(null);
      const response = success("chosen");
      const updated = response.data.route.legs[0];
      if (updated.type !== "BUS") throw new Error("fixture");
      updated.intermediateStops = [{ name: "新班次中間站" }];
      request.resolve(response);
      expect(await selection).toBe(true);
      const active = useMapStore.getState().activeBusLeg;
      if (closeWhilePending) expect(active).toBeNull();
      else {
        expect(active?.leg).toMatchObject({
          intermediateStops: [{ name: "新班次中間站" }],
          planContext: { routeToken: "chosen", legIndex: 0 },
        });
        expect(active?.key).toBe(
          busLegKey("0:0", {
            ...updated,
            planContext: { routeToken: "chosen", legIndex: 0 },
          }),
        );
      }
    },
  );

  it("confirms transfers using the latest route token and recomputed next candidate", async () => {
    const initial = route("old");
    const bus = initial.legs[0];
    if (bus.type !== "BUS") throw new Error("fixture");
    delete bus.selectedDeparture;
    bus.departureCandidates = departureCandidates;
    initial.legs.push({ ...bus });
    useMapStore.setState({
      selectRoute: { index: 0, route: initial },
      computeRoutes: [initial],
    });
    const first = success("first");
    first.data.route.legs.push({
      ...bus,
      departureCandidates: [
        { ...departureCandidates[1], candidateId: "updated-transfer" },
      ],
    });
    const second = success("second");
    second.data.route.legs.push({ ...second.data.route.legs[0] });
    vi.mocked(selectBusDeparture)
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    startNavigation();
    await vi.waitFor(() =>
      expect(useMapStore.getState().activeNavigationRoute?.routeToken).toBe(
        "second",
      ),
    );
    expect(selectBusDeparture).toHaveBeenNthCalledWith(
      2,
      { routeToken: "first", legIndex: 1, candidateId: "updated-transfer" },
      expect.any(AbortSignal),
    );
  });

  it("confirms the displayed default before starting local navigation", async () => {
    const initial = route("old");
    const bus = initial.legs[0];
    if (bus.type !== "BUS") throw new Error("fixture");
    delete bus.selectedDeparture;
    bus.departureCandidates = departureCandidates;
    useMapStore.setState({
      selectRoute: { index: 0, route: initial },
      computeRoutes: [initial],
    });
    const request = deferred();
    vi.mocked(selectBusDeparture).mockReturnValueOnce(request.promise);
    startNavigation();
    expect(useMapStore.getState().isNavigating).toBe(false);
    expect(selectBusDeparture).toHaveBeenCalledWith(
      { routeToken: "old", legIndex: 0, candidateId: "chosen-82" },
      expect.any(AbortSignal),
    );
    request.resolve(success("default-locked"));
    await vi.waitFor(() =>
      expect(useMapStore.getState().activeNavigationRoute?.routeToken).toBe(
        "default-locked",
      ),
    );
  });

  it("atomically replaces the selected route and starts navigation with its new identity", async () => {
    vi.mocked(selectBusDeparture).mockResolvedValue(success("chosen"));
    expect(await adoptBusDeparture("old", 0, "chosen-82")).toBe(true);
    const map = useMapStore.getState();
    expect(map.computeRoutes?.[0]).toBe(map.selectRoute?.route);
    expect(map.selectRoute?.route.routeToken).toBe("chosen");
    expect(map.busSelection).toBeNull();
    startNavigation();
    expect(useMapStore.getState().activeNavigationRoute?.routeToken).toBe(
      "chosen",
    );
    expect(useNavStore.getState().navigationId).toBe("navigation-chosen");
  });

  it("blocks navigation both while confirming and after failure, then allows a retry", async () => {
    const request = deferred();
    vi.mocked(selectBusDeparture).mockReturnValueOnce(request.promise);
    const selection = adoptBusDeparture("old", 0, "chosen-82");
    startNavigation();
    expect(useMapStore.getState().isNavigating).toBe(false);
    request.resolve({ ok: false, code: 409 } as ReturnType<typeof success>);
    expect(await selection).toBe(false);
    expect(useMapStore.getState().busSelection?.status).toBe("error");
    startNavigation();
    expect(useMapStore.getState().isNavigating).toBe(false);
    vi.mocked(selectBusDeparture).mockResolvedValueOnce(success("retry"));
    expect(await adoptBusDeparture("old", 0, "chosen-82")).toBe(true);
    startNavigation();
    expect(useMapStore.getState().activeNavigationRoute?.routeToken).toBe(
      "retry",
    );
  });

  it("ignores an old response after a newer selection, even when the transport ignores abort", async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(selectBusDeparture)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const a = adoptBusDeparture("old", 0, "early-12");
    const b = adoptBusDeparture("old", 0, "chosen-82");
    second.resolve(success("second"));
    expect(await b).toBe(true);
    first.resolve(success("first"));
    expect(await a).toBe(false);
    expect(useMapStore.getState().selectRoute?.route.routeToken).toBe("second");
    expect(useMapStore.getState().busSelection).toBeNull();
  });

  it("does not resurrect a route after the user changes routes", async () => {
    const request = deferred();
    vi.mocked(selectBusDeparture).mockReturnValue(request.promise);
    const selection = adoptBusDeparture("old", 0, "chosen-82");
    useMapStore.getState().setComputeRoutes([route("other")]);
    useMapStore.getState().setRouteSelect({ index: 0 });
    request.resolve(success("late"));
    expect(await selection).toBe(false);
    expect(useMapStore.getState().selectRoute?.route.routeToken).toBe("other");
    expect(useMapStore.getState().busSelection).toBeNull();
  });

  it("treats a timed out response as an error and preserves the prior plan", async () => {
    vi.useFakeTimers();
    const request = deferred();
    vi.mocked(selectBusDeparture).mockReturnValue(request.promise);
    const selection = adoptBusDeparture("old", 0, "chosen-82");
    await vi.advanceTimersByTimeAsync(30_000);
    request.resolve(success("too-late"));
    expect(await selection).toBe(false);
    expect(useMapStore.getState().busSelection?.status).toBe("error");
    expect(useMapStore.getState().selectRoute?.route.routeToken).toBe("old");
  });

  it("rejects switching a departure once navigation has begun", async () => {
    startNavigation();
    expect(await adoptBusDeparture("old", 0, "chosen-82")).toBe(false);
    expect(selectBusDeparture).not.toHaveBeenCalled();
  });
});
