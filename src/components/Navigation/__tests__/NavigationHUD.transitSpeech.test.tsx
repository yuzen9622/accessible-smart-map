import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  cursor: 0,
  effects: [] as (() => unknown)[],
  gemini: false,
  language: "en",
  buttons: [] as { onClick?: () => void }[],
  startApproach: vi.fn(),
  confirmArrival: vi.fn(),
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
    i18n: { language: h.language },
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
vi.mock("@/lib/navigation/navigationLifecycle", async (original) => ({
  ...(await original<typeof import("@/lib/navigation/navigationLifecycle")>()),
  startVenueApproach: h.startApproach,
  confirmVenueArrival: h.confirmArrival,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: ComponentProps<"button">) => {
    h.buttons.push({ onClick: onClick as (() => void) | undefined });
    return (
      <button {...props} onClick={onClick}>
        {children}
      </button>
    );
  },
}));

import type { VenueJourney } from "@/lib/indoor/journey";
import {
  confirmBoarded,
  newTransitRide,
} from "@/lib/navigation/transitRideRuntime";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute, NavInstruction } from "@/types/route";
import NavigationContent from "../../BottomSheet/NavigationContent";
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
  const markup = renderToStaticMarkup(<NavigationHUD />);
  // Run actual HUD effects in declaration order (including generic/transit/arrival/advisory).
  for (const effect of h.effects) effect();
  return markup;
}
beforeEach(() => {
  vi.useFakeTimers();
  h.refs.length = 0;
  h.gemini = false;
  h.language = "en";
  h.buttons.length = 0;
  h.startApproach.mockClear();
  h.confirmArrival.mockClear();
  h.synth.cancel.mockClear();
  h.synth.speak.mockClear();
  const events = new EventTarget();
  vi.stubGlobal("window", {
    speechSynthesis: h.synth,
    setTimeout,
    clearTimeout,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
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
    venueJourney: null,
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

describe("an upcoming arrival maneuver is not a completed arrival", () => {
  const walkInstructions = [
    { type: "depart", legType: "WALK", legIndex: 0, text: "WALK AHEAD" },
    {
      type: "arrive",
      legType: "WALK",
      legIndex: 0,
      text: "SOURCE ARRIVAL CLAIM",
    },
  ] as NavInstruction[];

  function prepareWalk(arrived = false) {
    const nav = useNavStore.getState();
    nav.setInstructions(walkInstructions);
    nav.setCurrentStepIndex(1);
    nav.setTransitRide(null, null);
    nav.setDistanceToNextM(100);
    nav.setArrived(arrived);
  }

  it("keeps the arrival target and distance but presents and speaks continuing while 100 metres away", () => {
    prepareWalk();
    const markup = frame();
    expect(markup).toContain("navContinueToDestination");
    expect(markup).not.toContain("SOURCE ARRIVAL CLAIM");
    expect(h.synth.speak).toHaveBeenCalledTimes(1);
    expect(h.synth.speak.mock.calls[0][0].text).toBe(
      "navContinueToDestination",
    );
    const nav = useNavStore.getState();
    expect(nav.arrived).toBe(false);
    expect(nav.currentStepIndex).toBe(1);
    expect(nav.distanceToNextM).toBe(100);
    expect(nav.instructions[1].text).toBe("SOURCE ARRIVAL CLAIM");
  });

  it("announces completed arrival only through the existing arrival effect", () => {
    prepareWalk(true);
    const markup = frame();
    expect(markup).toContain("arrivedDesc");
    expect(markup).not.toContain("navContinueToDestination");
    expect(h.synth.speak).toHaveBeenCalledTimes(1);
    expect(h.synth.speak.mock.calls[0][0].text).toBe("arrivedDesc");
  });

  it("does not claim arrival in either upcoming-maneuver preview", () => {
    prepareWalk();
    useNavStore.getState().setCurrentStepIndex(0);
    const markup = frame();
    expect(markup).toContain("WALK AHEAD");
    expect(markup).toContain("navContinueToDestination");
    expect(markup).not.toContain("SOURCE ARRIVAL CLAIM");
  });

  it("uses the same not-yet-arrived wording in the real step list", () => {
    prepareWalk();
    const markup = renderToStaticMarkup(<NavigationContent />);
    expect(markup).toContain("navContinueToDestination");
    expect(markup).not.toContain("SOURCE ARRIVAL CLAIM");
    useNavStore.getState().setArrived(true);
    expect(renderToStaticMarkup(<NavigationContent />)).toContain(
      "arrivedDesc",
    );
  });
});

describe("long straight walking stretch", () => {
  it("reminds continue-straight once per 500 m mark, after the step's own announcement", () => {
    const nav = useNavStore.getState();
    nav.setInstructions([
      { type: "depart", legType: "WALK", legIndex: 0, text: "DEPART" },
      { type: "turn", legType: "WALK", legIndex: 0, text: "TURN LEFT" },
      { type: "arrive", legType: "WALK", legIndex: 0, text: "ARRIVE" },
    ] as NavInstruction[]);
    nav.setTransitRide(null, null);
    nav.setCurrentStepIndex(1);
    nav.setDistanceToNextM(1200);
    frame();
    const spoken = () =>
      h.synth.speak.mock.calls.map(([utter]) => utter.text as string);
    expect(spoken()).toEqual(["TURN LEFT"]);

    for (const distance of [1060, 990, 960, 700, 485, 440]) {
      nav.setDistanceToNextM(distance);
      frame();
    }
    expect(spoken()).toEqual([
      "TURN LEFT",
      "navSpeakContinue",
      "navSpeakContinue",
    ]);
  });
});

describe("visible mixed-journey arrival actions in the outdoor HUD", () => {
  function prepareMixed(phase: "travel" | "approach", hasApproach = true) {
    const primary = {
      ...route,
      legs: [
        {
          type: "DRIVE",
          polyline: [
            [10, 10],
            [10.001, 10],
          ],
        },
      ] as AccessibleRoute["legs"],
    };
    const value = {
      id: "mixed-ui",
      guidance: { status: "outdoor", stepIndex: 0 },
      to: { name: "Synthetic Classroom" },
      outdoor: {
        phase,
        selectedIndex: 0,
        navigationIndex: 0,
        routes: [primary],
        arrival: { name: "Synthetic Gate" },
        approachRoutes: hasApproach
          ? { r: { ...route, routeToken: "walk-token" } }
          : undefined,
      },
    } as VenueJourney;
    useMapStore.setState({
      venueJourney: value,
      sidebarCollapsed: true,
      activeNavigationRoute:
        phase === "approach" ? value.outdoor?.approachRoutes?.r : primary,
    });
    h.language = "zh-TW";
    const nav = useNavStore.getState();
    nav.setInstructions([
      {
        type: "arrive",
        legType: "WALK",
        text: "SOURCE ARRIVAL CLAIM",
      } as NavInstruction,
    ]);
    nav.setCurrentStepIndex(0);
    nav.setTransitRide(null, null);
    nav.setArrived(true);
  }

  it("shows the parking handoff action in the actual HUD even with the sheet closed, and speaks the parking stage", () => {
    prepareMixed("travel");
    const markup = frame();
    expect(markup).toContain("已到下車點");
    expect(markup).toMatch(/<button[^>]*>已下車，繼續前往校門<\/button>/);
    expect(markup).toContain("endNav");
    expect(markup).not.toContain("arrivedDesc");
    expect(markup).not.toContain("SOURCE ARRIVAL CLAIM");
    expect(h.synth.speak).toHaveBeenCalledTimes(1);
    expect(h.synth.speak.mock.calls[0][0].text).toContain("已到下車點");
    h.buttons.at(-1)?.onClick?.();
    expect(h.startApproach).toHaveBeenCalledOnce();
    expect(h.confirmArrival).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "shows gate continuation without claiming classroom arrival (has approach: %s)",
    (hasApproach) => {
      prepareMixed(hasApproach ? "approach" : "travel", hasApproach);
      const markup = frame();
      expect(markup).toContain("接近校門");
      expect(markup).toMatch(/<button[^>]*>接續校內引導<\/button>/);
      expect(markup).not.toContain("arrivedDesc");
      expect(h.synth.speak.mock.calls[0][0].text).toContain("接近校門");
      h.buttons.at(-1)?.onClick?.();
      expect(h.confirmArrival).toHaveBeenCalledOnce();
      expect(h.startApproach).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    "uses the navigating primary even while previewing another candidate (active has approach: %s)",
    (activeHasApproach) => {
      prepareMixed("travel", activeHasApproach);
      const journey = useMapStore.getState().venueJourney;
      if (!journey?.outdoor) throw new Error("Expected outdoor fixture");
      const active = journey.outdoor.routes[0];
      const preview = { ...route, routeToken: "preview-primary" };
      useMapStore.setState({
        venueJourney: {
          ...journey,
          outdoor: {
            ...journey.outdoor,
            routes: [active, preview],
            selectedIndex: 1,
            navigationIndex: 0,
            approachRoutes: activeHasApproach
              ? journey.outdoor.approachRoutes
              : { "preview-primary": { ...route, routeToken: "preview-walk" } },
          },
        },
        selectRoute: { index: 1, route: preview },
      });
      const markup = frame();
      expect(markup).toContain(activeHasApproach ? "已到下車點" : "接近校門");
      expect(h.synth.speak.mock.calls[0][0].text).toContain(
        activeHasApproach ? "已到下車點" : "接近校門",
      );
      h.buttons.at(-1)?.onClick?.();
      expect(h.startApproach).toHaveBeenCalledTimes(activeHasApproach ? 1 : 0);
      expect(h.confirmArrival).toHaveBeenCalledTimes(activeHasApproach ? 0 : 1);
      expect(useMapStore.getState().activeNavigationRoute).toBe(active);
    },
  );

  it("keeps the arrival action and speech in the current UI language", () => {
    prepareMixed("travel");
    h.language = "en";
    const markup = frame();
    expect(markup).toContain("You have reached the drop-off point");
    expect(markup).toMatch(
      /<button[^>]*>Continue on foot to the campus entrance<\/button>/,
    );
    expect(h.synth.speak.mock.calls[0][0].text).toContain(
      "You have reached the drop-off point",
    );
    expect(markup).not.toContain("已到下車點");
  });

  it.each(["walk", "transit"] as const)(
    "offers a walking continuation without a false drop-off claim when the %s primary ends on foot",
    (travelMode) => {
      prepareMixed("travel");
      const value = useMapStore.getState().venueJourney;
      if (!value?.outdoor) throw new Error("Expected outdoor fixture");
      const primary = {
        ...value.outdoor.routes[0],
        legs: [
          ...(travelMode === "transit"
            ? [
                {
                  type: "BUS",
                  polyline: [
                    [9, 10],
                    [10, 10],
                  ],
                },
              ]
            : []),
          {
            type: "WALK",
            polyline: [
              [10, 10],
              [10.001, 10],
            ],
          },
        ] as AccessibleRoute["legs"],
      };
      useMapStore.setState({
        venueJourney: {
          ...value,
          outdoor: { ...value.outdoor, travelMode, routes: [primary] },
        },
        activeNavigationRoute: primary,
      });
      const markup = frame();
      expect(markup).toMatch(/<button[^>]*>繼續步行前往校門<\/button>/);
      expect(markup).not.toContain("下車");
      expect(markup).not.toContain("接近校門");
      expect(h.synth.speak.mock.calls[0][0].text).toContain("繼續步行");
      expect(h.synth.speak.mock.calls[0][0].text).not.toContain("下車");
      h.buttons.at(-1)?.onClick?.();
      expect(h.startApproach).toHaveBeenCalledOnce();
      expect(h.confirmArrival).not.toHaveBeenCalled();
    },
  );

  it("keeps the ordinary HUD without origin notices or premature venue arrival actions before reaching the path", () => {
    prepareMixed("travel", false);
    const value = useMapStore.getState().venueJourney;
    if (!value?.outdoor) throw new Error("Expected outdoor fixture");
    const primary = {
      ...value.outdoor.routes[0],
      legs: [
        {
          type: "WALK",
          polyline: [
            [0.000125, 0],
            [0.001, 0],
          ],
        },
      ] as AccessibleRoute["legs"],
    };
    useMapStore.setState({
      venueJourney: {
        ...value,
        outdoor: {
          ...value.outdoor,
          origin: {
            kind: "coordinate",
            position: { lat: 0, lng: 0 },
            address: "Original origin",
          },
          routes: [primary],
        },
      },
      activeNavigationRoute: primary,
      userLocation: { lat: 0, lng: 0 },
    });
    useNavStore.getState().setArrived(false);
    const markup = frame();
    expect(markup).not.toContain("路線從附近道路開始");
    expect(markup).not.toContain("查看路線起點");
    expect(markup).not.toContain("校內部分路段的高差或通行條件待確認");
    expect(markup).not.toContain("接續校內引導");
    expect(markup).not.toContain("下車");
    expect(markup).toContain("navContinueToDestination");
    expect(useMapStore.getState().activeNavigationRoute).toBe(primary);
    expect(useNavStore.getState().arrived).toBe(false);
  });
});
