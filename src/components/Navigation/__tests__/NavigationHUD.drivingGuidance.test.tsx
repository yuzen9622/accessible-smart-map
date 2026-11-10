import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import zh from "@/i18n/locale/zh-TW/translation.json";
import type { AccessibleRoute, NavInstruction } from "@/types/route";

const h = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  cursor: 0,
  effects: [] as (() => unknown)[],
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
for (const store of ["@/stores/useMapStore", "@/stores/useNavStore"]) {
  vi.doMock(store, async () => {
    const actual = await vi.importActual<{
      default: { getState: () => unknown };
    }>(store);
    return {
      ...actual,
      default: Object.assign(
        (selector: (s: unknown) => unknown) =>
          selector(actual.default.getState()),
        actual.default,
      ),
    };
  });
}
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const text = zh[key as keyof typeof zh];
      if (typeof text !== "string") return key;
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(options?.[name] ?? ""),
      );
    },
    i18n: { language: "zh-TW" },
  }),
}));
vi.mock("@/hook/useComputeRoute", () => ({
  default: () => ({ handleComputeRoute: vi.fn(), isLoading: false }),
}));
vi.mock("@/hook/useNavigationAudio", () => ({
  default: () => ({
    geminiOwnsSpeech: false,
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

const { default: useMapStore } = await import("@/stores/useMapStore");
const { default: useNavStore } = await import("@/stores/useNavStore");
const { default: NavigationHUD } = await import("../NavigationHUD");

const route = {
  routeId: "drive",
  routeToken: "tok",
  navigationId: "nav",
  routeVersion: 1,
  totalMinutes: 10,
  legs: [
    {
      type: "DRIVE",
      polyline: Array.from({ length: 30 }, (_, i) => [121.5, 25 + i * 0.001]),
      speedLimits: {
        status: "available",
        direction: "along_leg",
        segments: [
          {
            fromIndex: 0,
            toIndex: 10,
            kind: "known",
            limitKph: 40,
            source: "valhalla",
          },
          {
            fromIndex: 10,
            toIndex: 15,
            kind: "unknown",
            limitKph: null,
            source: null,
          },
          {
            fromIndex: 15,
            toIndex: 20,
            kind: "known",
            limitKph: 40,
            source: "valhalla",
          },
          {
            fromIndex: 20,
            toIndex: 29,
            kind: "known",
            limitKph: 60,
            source: "valhalla",
          },
        ],
      },
    },
  ],
} as unknown as AccessibleRoute;

const instructions = [
  {
    type: "turn",
    legType: "DRIVE",
    legIndex: 0,
    polylineIndex: 28,
    text: "右轉進入「民生東路」，請靠右側兩個車道",
    streetName: "民生東路",
    relativeDirection: "right",
    bearing: null,
    distanceM: 500,
    roadGuidance: {
      maneuverIndex: 3,
      maneuver: "right",
      endPolylineIndex: 29,
      streetNames: ["民生東路"],
      lanes: [
        {
          directions: ["straight"],
          recommendation: "not_recommended",
          maneuverDirection: null,
        },
        {
          directions: ["right"],
          recommendation: "usable",
          maneuverDirection: "right",
        },
        {
          directions: ["right"],
          recommendation: "preferred",
          maneuverDirection: "right",
        },
      ],
      laneApproachRange: { fromIndex: 22, toIndex: 28 },
      laneHint: "靠右側兩個車道",
    },
  },
] as unknown as NavInstruction[];

function frame() {
  h.cursor = 0;
  h.effects.length = 0;
  const markup = renderToStaticMarkup(<NavigationHUD />);
  for (const effect of h.effects) effect();
  return markup;
}

function driveTo(segmentIndex: number) {
  useNavStore.getState().setRouteProgress({
    routeToken: "tok",
    navigationId: "nav",
    routeVersion: 1,
    legIndex: 0,
    segmentIndex,
    alongM: segmentIndex * 111,
    observedAt: Date.now(),
    source: "gps",
  });
  return frame();
}

const spoken = () =>
  h.synth.speak.mock.calls.map(([utterance]) => utterance.text as string);

beforeEach(() => {
  vi.useFakeTimers();
  h.refs.length = 0;
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
  nav.setNavigationIdentity("nav", 1);
  nav.setInstructions(instructions);
  nav.promoteToLive();
  nav.setVoiceEnabled(true);
  frame();
  h.synth.speak.mockClear();
  h.synth.cancel.mockClear();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("driving HUD speed limit and lanes", () => {
  it("shows the current segment's limit and hides it on unknown segments", () => {
    expect(driveTo(5)).toContain("限速 40 km/h");
    const unknown = driveTo(12);
    expect(unknown).not.toContain("km/h");
    expect(unknown).not.toContain("資料標示不限速");
    expect(driveTo(21)).toContain("限速 60 km/h");
  });

  it("shows nothing without progress", () => {
    expect(frame()).not.toContain("km/h");
  });

  it("announces a different known limit once, queued behind the current line; unknown is silent", () => {
    driveTo(5);
    driveTo(12);
    driveTo(17);
    expect(spoken()).toEqual([]);
    driveTo(21);
    driveTo(22);
    expect(spoken()).toEqual(["進入限速 60 公里路段"]);
    expect(h.synth.cancel).not.toHaveBeenCalled();
  });

  it("draws lanes only inside the approach range of the upcoming turn", () => {
    expect(driveTo(21)).not.toContain("條車道");
    const inRange = driveTo(22);
    expect(inRange).toContain(
      'aria-label="3 條車道，建議走左起第 3 車道，第 2 車道也可行駛"',
    );
    expect(inRange).toContain("靠右側兩個車道");
    expect(driveTo(27)).toContain("條車道");
    expect(driveTo(28)).not.toContain("條車道");
  });
});
