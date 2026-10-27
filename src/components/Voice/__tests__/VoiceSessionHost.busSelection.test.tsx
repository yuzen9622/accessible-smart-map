import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceNavigationEvent } from "@/lib/voice/voiceSession";

const h = vi.hoisted(() => ({
  effects: [] as (() => undefined | (() => void))[],
  events: [] as VoiceNavigationEvent[],
  setNavigationRoute: vi.fn(),
  cancelNavigation: vi.fn(),
  consumeNavigationEvents: vi.fn(),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: (effect: () => undefined | (() => void)) => h.effects.push(effect),
  useRef: (value: unknown) => ({ current: value }),
}));
vi.mock("@/hook/useVoiceSession", () => ({
  default: () => ({
    status: { status: "listening" },
    transcripts: [],
    activeTool: null,
    toolActivities: [],
    navigationEvents: h.events,
    startSession: vi.fn(),
    endSession: vi.fn(),
    resumePlayback: vi.fn(),
    setMuted: vi.fn(),
    sendNavigationPosition: vi.fn(),
    setNavigationRoute: h.setNavigationRoute,
    cancelNavigation: h.cancelNavigation,
    consumeNavigationEvents: h.consumeNavigationEvents,
  }),
}));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../VoiceFloatingIndicator", () => ({ default: () => null }));

import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute, NavInstruction } from "@/types/route";
import VoiceSessionHost from "../VoiceSessionHost";

const route = (token: string): AccessibleRoute => ({
  routeId: token,
  routeToken: token,
  navigationId: `nav-${token}`,
  routeVersion: 1,
  routeName: "99",
  totalMinutes: 10,
  transferCount: 0,
  accessibilityHighlights: [],
  legs: [],
});
const start = (token = "old"): VoiceNavigationEvent => ({
  type: "nav.start",
  armedRouteToken: token,
  currentStepIndex: 0,
  totalSteps: 1,
  steps: [
    {
      index: 0,
      instruction: "Board chosen bus",
      legType: "BUS",
      distanceM: null,
      isTransit: true,
      type: "transit_board",
    },
  ],
});
const selection = (status: "pending" | "error") => ({
  routeToken: "old",
  legIndex: 0,
  candidateId: "chosen",
  status,
});
let cleanup: (() => void) | undefined;
function render() {
  h.effects.length = 0;
  VoiceSessionHost();
}
beforeEach(() => {
  vi.clearAllMocks();
  h.events = [];
  useNavStore.getState().reset();
  useMapStore.setState(useMapStore.getInitialState());
  const initial = route("old");
  useMapStore.setState({
    selectRoute: { index: 0, route: initial },
    computeRoutes: [initial],
  });
});
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("voice start while selecting a bus", () => {
  it("cancels the old armed capability during pending/error and arms the adopted route", () => {
    render();
    cleanup = h.effects[5]();
    expect(h.setNavigationRoute).toHaveBeenLastCalledWith("old");
    useMapStore.setState({ busSelection: selection("pending") });
    expect(h.setNavigationRoute).toHaveBeenLastCalledWith(null);
    expect(h.cancelNavigation).toHaveBeenCalledOnce();
    useMapStore.setState({ busSelection: selection("error") });
    expect(h.setNavigationRoute).toHaveBeenLastCalledWith(null);
    const adopted = route("adopted");
    useMapStore.setState({
      busSelection: null,
      selectRoute: { index: 0, route: adopted },
      computeRoutes: [adopted],
    });
    expect(h.setNavigationRoute).toHaveBeenLastCalledWith("adopted");
  });

  it.each(["pending", "error"] as const)(
    "rejects a queued start and following events before mutating local state (%s)",
    (status) => {
      useMapStore.setState({ busSelection: selection(status) });
      const original = [
        {
          type: "depart",
          text: "Local",
          legType: "WALK",
          bearing: null,
          relativeDirection: null,
          distanceM: null,
          streetName: null,
          polylineIndex: null,
        },
      ] as NavInstruction[];
      useNavStore.getState().setInstructions(original);
      h.events = [
        start(),
        {
          type: "nav.step",
          currentStepIndex: 3,
          instruction: "Wrong bus",
          remainingM: 12,
        },
        { type: "nav.arrived" },
        { type: "nav.offroute", distanceM: 50 } as VoiceNavigationEvent,
      ];
      render();
      h.effects[9]();
      expect(h.cancelNavigation).toHaveBeenCalledOnce();
      expect(useMapStore.getState().isNavigating).toBe(false);
      expect(useNavStore.getState()).toMatchObject({
        navigationSource: "local",
        instructions: original,
        currentStepIndex: 0,
        arrived: false,
        isOffRoute: false,
      });
      expect(h.consumeNavigationEvents).toHaveBeenCalledWith(4);
    },
  );

  it("starts the exact newly adopted token once selection completes", () => {
    const adopted = route("adopted");
    useMapStore.setState({
      busSelection: null,
      selectRoute: { index: 0, route: adopted },
      computeRoutes: [adopted],
    });
    h.events = [start("adopted")];
    render();
    h.effects[9]();
    expect(h.cancelNavigation).not.toHaveBeenCalled();
    expect(useMapStore.getState().activeNavigationRoute?.routeToken).toBe(
      "adopted",
    );
    expect(useMapStore.getState().isNavigating).toBe(true);
    expect(useNavStore.getState()).toMatchObject({
      navigationSource: "voice",
      navigationId: "nav-adopted",
    });
  });

  it("keeps server-planned voice starts without a UI selection synchronous", () => {
    const event = start();
    if (event.type !== "nav.start") throw new Error("Start fixture");
    delete event.armedRouteToken;
    h.events = [event];
    render();
    h.effects[9]();
    expect(useMapStore.getState().isNavigating).toBe(true);
    expect(useNavStore.getState().navigationSource).toBe("voice");
  });
});
