import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  cursor: 0,
  effects: [] as (() => unknown)[],
  gemini: false,
  synth: { cancel: vi.fn(), speak: vi.fn() },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (value: unknown) => {
    const index = h.cursor++;
    if (!h.refs[index]) h.refs[index] = { current: value };
    return h.refs[index];
  },
  useEffect: (effect: () => unknown) => {
    h.effects.push(effect);
  },
}));
vi.mock("@/stores/useMapStore", async (original) => {
  const actual = await original<typeof import("@/stores/useMapStore")>();
  return {
    ...actual,
    default: Object.assign(
      (selector: (s: ReturnType<typeof actual.default.getState>) => unknown) =>
        selector(actual.default.getState()),
      actual.default,
    ),
  };
});
vi.mock("@/stores/useNavStore", async (original) => {
  const actual = await original<typeof import("@/stores/useNavStore")>();
  return {
    ...actual,
    default: Object.assign(
      (selector: (s: ReturnType<typeof actual.default.getState>) => unknown) =>
        selector(actual.default.getState()),
      actual.default,
    ),
  };
});
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en" },
  }),
}));
vi.mock("@/hook/useComputeRoute", () => ({
  default: () => ({ handleComputeRoute: vi.fn(), isLoading: false }),
}));
vi.mock("@/hook/useNavigationAudio", () => ({
  default: () => ({
    geminiOwnsSpeech: h.gemini,
    isAudioActive: true,
    toggleAudio: vi.fn(),
  }),
}));
vi.mock("@/lib/api/a11y", async (original) => ({
  ...(await original<typeof import("@/lib/api/a11y")>()),
  getSafetyHazardReports: vi.fn(async () => ({
    ok: true,
    data: { reports: [] },
  })),
}));

import {
  confirmBoarded,
  newTransitRide,
} from "@/lib/navigation/transitRideRuntime";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute, NavInstruction } from "@/types/route";
import NavigationHUD from "../NavigationHUD";

const instructions = [
  { type: "transit_board", legType: "BUS", legIndex: 0, text: "board" },
  { type: "transit_alight", legType: "BUS", legIndex: 0, text: "alight" },
  { type: "turn", legType: "WALK", legIndex: 1, text: "WALK NOW" },
] as NavInstruction[];
const route = {
  routeToken: "r",
  navigationId: "n",
  routeVersion: 1,
  legs: [],
} as unknown as AccessibleRoute;
function frame() {
  h.cursor = 0;
  h.effects.length = 0;
  renderToStaticMarkup(<NavigationHUD />);
  // Run actual HUD effects in declaration order (including generic/transit/arrival/advisory).
  for (const effect of h.effects) effect();
}
beforeEach(() => {
  vi.useFakeTimers();
  h.refs.length = 0;
  h.gemini = false;
  h.synth.cancel.mockClear();
  h.synth.speak.mockClear();
  vi.stubGlobal("window", {
    speechSynthesis: h.synth,
    setTimeout,
    clearTimeout,
  });
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      constructor(public text: string) {}
    },
  );
  useNavStore.getState().reset();
  useMapStore.setState({
    activeNavigationRoute: route,
    isNavigating: true,
    userLocation: null,
  });
  const nav = useNavStore.getState();
  nav.setNavigationIdentity("n", 1);
  nav.setInstructions(instructions);
  nav.promoteToLive();
  nav.setVoiceEnabled(true);
  nav.setCurrentStepIndex(1);
  nav.setTransitRide(confirmBoarded(newTransitRide("bus"), 0), {
    phase: "riding",
    routeName: "99",
    alightStop: "C",
    stopsLeft: 2,
    minutes: null,
    minutesSource: null,
  });
  frame();
  h.synth.speak.mockClear();
  h.synth.cancel.mockClear();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("real HUD effect ordering on bus exit", () => {
  it("speaks alight on GPS step crossing after ride/guide cleanup, not WALK or arrival; repeated renders do not cancel it", () => {
    useNavStore.getState().setCurrentStepIndex(2);
    useNavStore.getState().setTransitRide(null, null);
    useNavStore.getState().setArrived(true);
    frame();
    expect(h.synth.speak).toHaveBeenCalledTimes(1);
    expect(h.synth.speak.mock.calls[0][0].text).toBe("navBusSpeakAlight");
    expect(h.synth.cancel).toHaveBeenCalledTimes(1);
    frame();
    expect(h.synth.speak).toHaveBeenCalledTimes(1);
    expect(h.synth.cancel).toHaveBeenCalledTimes(1);
  });
  it.each([
    "route",
    "session",
    "version",
    "instructions",
    "reroute",
    "voice",
    "gemini",
    "stop",
    "preview",
  ])("does not synthesize an old alight on %s cleanup", (reason) => {
    const nav = useNavStore.getState();
    if (reason === "route")
      useMapStore.setState({
        activeNavigationRoute: { ...route, routeToken: "new" },
      });
    if (reason === "session") nav.setNavigationIdentity("new", 1);
    if (reason === "version") nav.setNavigationIdentity("n", 2);
    if (reason === "instructions") nav.setInstructions([...instructions]);
    if (reason === "reroute") nav.setReroutePending();
    if (reason === "voice") nav.setNavigationSource("voice");
    if (reason === "gemini") h.gemini = true;
    if (reason === "stop") useMapStore.setState({ isNavigating: false });
    if (reason === "preview")
      useNavStore.setState({ navigationMode: "preview" });
    nav.setCurrentStepIndex(2);
    nav.setTransitRide(null, null);
    frame();
    expect(
      h.synth.speak.mock.calls.some(
        ([utter]) => utter.text === "navBusSpeakAlight",
      ),
    ).toBe(false);
  });
});
