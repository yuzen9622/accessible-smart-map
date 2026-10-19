import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VenueJourney } from "@/lib/indoor/journey";
import useMapStore from "@/stores/useMapStore";
import type { VenuePlaceDetail } from "@/types";
import VenueJourneyPlayback from "../VenueJourneyPlayback";

const h = vi.hoisted(() => ({
  effects: [] as (() => undefined | (() => void))[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => undefined | (() => void)) => h.effects.push(effect),
}));
vi.mock("@/stores/useMapStore", async (original) => {
  const actual = await original<typeof import("@/stores/useMapStore")>();
  return {
    ...actual,
    default: Object.assign(
      (
        selector: (
          state: ReturnType<typeof actual.default.getState>,
        ) => unknown,
      ) => selector(actual.default.getState()),
      actual.default,
    ),
  };
});

const frameCallbacks = new Map<number, FrameRequestCallback>();
const visibilityListeners = new Set<() => void>();
const motionListeners = new Set<(event: { matches: boolean }) => void>();
let frameId = 0;
let hidden = false;
let cleanup: (() => void) | undefined;
beforeEach(() => {
  h.effects.length = 0;
  frameCallbacks.clear();
  visibilityListeners.clear();
  motionListeners.clear();
  frameId = 0;
  hidden = false;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frameCallbacks.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    frameCallbacks.delete(id),
  );
  vi.stubGlobal("document", {
    get hidden() {
      return hidden;
    },
    addEventListener: (_: string, callback: () => void) =>
      visibilityListeners.add(callback),
    removeEventListener: (_: string, callback: () => void) =>
      visibilityListeners.delete(callback),
  });
  vi.stubGlobal("window", {
    matchMedia: () => ({
      matches: false,
      addEventListener: (
        _: string,
        callback: (event: { matches: boolean }) => void,
      ) => motionListeners.add(callback),
      removeEventListener: (
        _: string,
        callback: (event: { matches: boolean }) => void,
      ) => motionListeners.delete(callback),
    }),
  });
  const endpoint: VenuePlaceDetail = {
    kind: "venue-place",
    venueId: "synthetic-campus",
    buildingId: "a",
    buildingName: "Building A",
    levelRef: "1F",
    placeId: "a",
    sourceVersion: "synthetic",
    dataSource: "local",
    arrivalKind: "corridor",
    name: "Source point",
    address: "Source hall",
    position: { lat: 0, lng: 0 },
  };
  const journey: VenueJourney = {
    id: "synthetic-tour",
    venueId: endpoint.venueId,
    buildingId: "a",
    sourceVersion: "synthetic",
    from: endpoint,
    to: { ...endpoint, placeId: "b" },
    mode: "normal",
    verticalPreference: "auto",
    guidance: { status: "touring", stepIndex: 0 },
    preview: { progress: 0, direction: 1, playing: true, following: false },
    route: {
      ok: true,
      fromPlaceId: "a",
      toPlaceId: "b",
      points: [
        [0, 0, 0],
        [10, 0, 0],
      ],
      kinds: ["corridor"],
      distanceM: 1000,
      animationSafe: false,
      warnings: [],
      edgeIds: [],
      steps: [
        {
          kind: "corridor",
          name: "Source hall",
          fromLevel: "1F",
          toLevel: "1F",
          distanceM: 10,
          startIndex: 0,
          endIndex: 1,
          heightPending: true,
        },
      ],
    },
  };
  useMapStore.setState({ venueJourney: journey });
  cleanup = undefined;
});
afterEach(() => {
  cleanup?.();
  vi.unstubAllGlobals();
});
function frame(time: number) {
  const pending = [...frameCallbacks.values()];
  frameCallbacks.clear();
  for (const callback of pending) callback(time);
}

function mountClock(status: "idle" | "touring" = "touring") {
  const journey = useMapStore.getState().venueJourney;
  if (!journey) throw new Error("Missing synthetic journey");
  useMapStore.setState({
    venueJourney: {
      ...journey,
      guidance: { ...journey.guidance, status },
      route: { ...journey.route, animationSafe: status === "idle" },
    },
  });
  renderToStaticMarkup(<VenueJourneyPlayback />);
  cleanup = h.effects.at(-1)?.() || undefined;
}

describe("the route animation clock", () => {
  it("leaves touring progress and physical arrival unchanged without scheduling a cursor clock", () => {
    useMapStore.getState().setVenueJourneyPreview({ progress: 0.4 });
    mountClock();
    const before = useMapStore.getState().venueJourney;
    expect(frameCallbacks.size).toBe(0);
    frame(100);
    frame(200);
    frame(3600000);
    expect(useMapStore.getState().venueJourney).toBe(before);
    expect(useMapStore.getState().venueJourney?.preview).toMatchObject({
      progress: 0.4,
      playing: true,
      following: false,
    });
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe(
      "touring",
    );
  });
  it("keeps the idle diagnostic clock based on source distance and stops only its own playback at the endpoint", () => {
    mountClock("idle");
    frame(100);
    frame(200);
    expect(useMapStore.getState().venueJourney?.preview.progress).toBeCloseTo(
      0.018,
    );
    useMapStore.getState().setVenueJourneyPreview({ progress: 0.999 });
    frame(300);
    expect(useMapStore.getState().venueJourney?.preview).toMatchObject({
      progress: 1,
      playing: false,
    });
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe("idle");
    expect(frameCallbacks.size).toBe(0);
  });
  it("does not accumulate hidden-tab time during idle diagnostic playback", () => {
    mountClock("idle");
    frame(100);
    frame(200);
    const before = useMapStore.getState().venueJourney?.preview.progress;
    hidden = true;
    for (const callback of visibilityListeners) callback();
    frame(3600000);
    expect(useMapStore.getState().venueJourney?.preview.progress).toBe(before);
    hidden = false;
    for (const callback of visibilityListeners) callback();
    frame(7200000);
    expect(useMapStore.getState().venueJourney?.preview.progress).toBe(before);
    frame(7200100);
    expect(useMapStore.getState().venueJourney?.preview.progress).toBeCloseTo(
      (before ?? 0) + 0.018,
    );
  });
  it("does not let an already-scheduled diagnostic frame advance a newly started route animation", () => {
    mountClock("idle");
    frame(100);
    useMapStore.getState().startVenueTour();
    const before = useMapStore.getState().venueJourney;
    frame(200);
    expect(useMapStore.getState().venueJourney).toBe(before);
    expect(frameCallbacks.size).toBe(0);
  });
  it("pauses route animation when reduced motion is enabled and removes its listener", () => {
    mountClock();
    const before = useMapStore.getState().venueJourney?.preview.progress;
    for (const callback of motionListeners) callback({ matches: true });
    expect(useMapStore.getState().venueJourney?.preview).toMatchObject({
      progress: before,
      playing: false,
    });
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe(
      "touring",
    );
    cleanup?.();
    cleanup = undefined;
    expect(visibilityListeners.size).toBe(0);
    expect(motionListeners.size).toBe(0);
    expect(frameCallbacks.size).toBe(0);
  });
});
