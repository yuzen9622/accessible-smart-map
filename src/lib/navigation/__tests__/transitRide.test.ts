import { beforeEach, describe, expect, it } from "vitest";
import { buildCumulativePath } from "@/lib/geo";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type {
  AccessibleRoute,
  BusLeg,
  LiveBus,
  NavInstruction,
} from "@/types/route";
import { shouldSpeakLocally } from "../navigationAudio";
import { startNavigation, stopNavigation } from "../navigationLifecycle";
import { navigationCopyDefault } from "../transitCopy";
import {
  buildTransitGuide,
  findBusRuns,
  rideStops,
  transitAnnouncement,
} from "../transitRide";
import {
  confirmBoarded,
  guardBusProgress,
  matchesBoardedVehicle,
  newTransitRide,
  rememberVehicle,
  sampleBoarding,
} from "../transitRideRuntime";

const bus = {
  plateNumb: "BUS-1",
  direction: 1,
  subRouteUid: "BRANCH",
  isTarget: true,
} as LiveBus;
const leg = {
  type: "BUS",
  routeName: "99",
  departureStop: "A",
  arrivalStop: "C",
  departureTime: "23:50",
  arrivalTime: "00:10",
  intermediateStops: [{ name: "B", location: [121.002, 25] }],
  polyline: [
    [121, 25],
    [121.002, 25],
    [121.004, 25],
  ],
} as BusLeg;
const steps = [
  { type: "transit_board", legType: "BUS", legIndex: 0, text: "board" },
  { type: "transit_alight", legType: "BUS", legIndex: 0, text: "alight" },
] as NavInstruction[];
const route = {
  routeToken: "route",
  navigationId: "nav",
  routeVersion: 1,
  legs: [leg],
} as AccessibleRoute;
const cp = buildCumulativePath(route.legs);
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Expected fixture/runtime value");
  return value;
}

beforeEach(() => useNavStore.getState().reset());
describe("continuous boarding evidence", () => {
  it("never boards from one far GPS jump, even greater than 200m", () => {
    let ride = sampleBoarding(newTransitRide("run"), 0, 0, 1000, 0);
    ride = sampleBoarding(ride, 250, 0, 2000, 0);
    expect(ride.boarded).toBe(false);
    expect(ride.movingSamples).toBe(0);
  });
  it("needs two sensible continuous intervals after observing the stop", () => {
    let ride = sampleBoarding(newTransitRide("run"), 0, 0, 1000, 0);
    ride = sampleBoarding(ride, 30, 0, 6000, 0);
    expect(ride.boarded).toBe(false);
    ride = sampleBoarding(ride, 60, 0, 11000, 0);
    expect(ride.boarded).toBe(true);
  });
  it.each([
    [250, 2000, 0],
    [30, 30000, 0],
    [-30, 6000, 0],
    [30, 6000, 100],
    [5, 6000, 0],
  ])(
    "breaks evidence on jump/gap/reversal/off-route/walking (%s,%s,%s)",
    (distance, at, perpendicular) => {
      let ride = sampleBoarding(newTransitRide("run"), 0, 0, 1000, 0);
      ride = sampleBoarding(ride, distance, 0, at, perpendicular);
      expect(ride.boarded).toBe(false);
      expect(ride.movingSamples).toBe(0);
    },
  );
  it("does not infer boarding without a prior station observation", () => {
    let ride = sampleBoarding(newTransitRide("run"), 200, 0, 1000, 0);
    ride = sampleBoarding(ride, 230, 0, 6000, 0);
    ride = sampleBoarding(ride, 260, 0, 11000, 0);
    expect(ride.boarded).toBe(false);
  });
  it.each([
    [30000, 0],
    [6000, 100],
    [2000, 0],
  ])(
    "revokes station evidence after a remote chain break (%s/%s)",
    (at, perp) => {
      let ride = sampleBoarding(newTransitRide("run"), 0, 0, 1000, 0);
      ride = sampleBoarding(ride, 250, 0, at, perp);
      ride = sampleBoarding(ride, 280, 0, at + 5000, 0);
      ride = sampleBoarding(ride, 310, 0, at + 10000, 0);
      ride = sampleBoarding(ride, 340, 0, at + 15000, 0);
      expect(ride.boarded).toBe(false);
      ride = sampleBoarding(ride, 0, 0, at + 20000, 0);
      ride = sampleBoarding(ride, 30, 0, at + 25000, 0);
      ride = sampleBoarding(ride, 60, 0, at + 30000, 0);
      expect(ride.boarded).toBe(true);
    },
  );
  it("a remote reversal revokes the stop observation, but explicit boarding still works", () => {
    let ride = sampleBoarding(newTransitRide("run"), 0, 0, 1000, 0);
    ride = sampleBoarding(ride, 60, 0, 6000, 0);
    ride = sampleBoarding(ride, 45, 0, 11000, 0);
    ride = sampleBoarding(ride, 75, 0, 16000, 0);
    ride = sampleBoarding(ride, 105, 0, 21000, 0);
    expect(ride.observedAtStop).toBe(false);
    expect(ride.boarded).toBe(false);
    expect(confirmBoarded(ride, 22000).boarded).toBe(true);
  });
  it("ignores duplicate and sub-second React/GPS samples without breaking valid evidence", () => {
    let ride = sampleBoarding(newTransitRide("run"), 0, 0, 1000, 0);
    ride = sampleBoarding(ride, 30, 0, 6000, 0);
    ride = sampleBoarding(ride, 30, 0, 6000, 0);
    ride = sampleBoarding(ride, 31, 0, 6100, 0);
    ride = sampleBoarding(ride, 60, 0, 11000, 0);
    expect(ride.boarded).toBe(true);
  });
  it("locks a fresh trusted plate and never replaces it with the next vehicle", () => {
    let ride = rememberVehicle(newTransitRide("run"), bus, 1000);
    ride = confirmBoarded(ride, 2000);
    ride = rememberVehicle(ride, { ...bus, plateNumb: "BUS-2" }, 3000);
    expect(ride.vehicle?.plate).toBe("BUS-1");
    expect(
      matchesBoardedVehicle(required(ride.vehicle), { ...bus, direction: 0 }),
    ).toBe(false);
    expect(
      matchesBoardedVehicle(required(ride.vehicle), {
        ...bus,
        subRouteUid: "OTHER",
      }),
    ).toBe(false);
  });
  it("does not lock expired or missing evidence", () => {
    const ride = rememberVehicle(newTransitRide("run"), bus, 1000);
    expect(confirmBoarded(ride, 27000).vehicle).toBeNull();
    expect(confirmBoarded(newTransitRide("run"), 1000).vehicle).toBeNull();
  });
});
describe("boarding gates and guide", () => {
  const advance = (
    overrides: Partial<Parameters<typeof guardBusProgress>[0]> = {},
  ) =>
    guardBusProgress({
      instructions: steps,
      route,
      cp,
      currentIndex: 0,
      nextIndex: 1,
      ride: null,
      alongM: 0,
      perpendicularM: 0,
      at: 1000,
      ...overrides,
    });
  it("holds boarding at the stop instead of skipping to alight", () => {
    const result = advance();
    expect(result.nextIndex).toBe(0);
    expect(result.waitingGate).toBe(true);
  });
  it("does not arrive after jumping to the destination", () => {
    const result = advance({ alongM: required(cp.cumM.at(-1)) });
    expect(result.waitingGate).toBe(true);
  });
  it("resets boarded state on route/version/session change", () => {
    const ride = confirmBoarded(required(advance().ride), 2000);
    for (const replacement of [
      { ...route, routeVersion: 2 },
      { ...route, navigationId: "next" },
      { ...route, routeToken: "new" },
    ]) {
      const result = advance({ route: replacement, ride, alongM: 250 });
      expect(result.ride?.boarded).toBe(false);
      expect(result.waitingGate).toBe(true);
    }
  });
  it("does not skip a transfer when one GPS sample projects beyond both runs", () => {
    const transferSteps = [
      ...steps,
      { type: "turn", legType: "WALK", legIndex: 1 },
      ...steps.map((s) => ({ ...s, legIndex: 2 })),
    ] as NavInstruction[];
    const transferRoute = {
      ...route,
      legs: [leg, { ...leg, type: "WALK" }, leg],
    } as AccessibleRoute;
    const ride = confirmBoarded(required(advance().ride), 2000);
    const result = advance({
      instructions: transferSteps,
      route: transferRoute,
      cp: buildCumulativePath(transferRoute.legs),
      ride,
      currentIndex: 1,
      nextIndex: 4,
      alongM: 3000,
    });
    expect(result.nextIndex).toBe(3);
    expect(result.ride?.boarded).toBe(false);
    expect(result.ride?.vehicle).toBeNull();
  });
  it("separates direct BUS-to-BUS transfers without walking steps", () => {
    const directSteps = [
      ...steps,
      ...steps.map((s) => ({ ...s, legIndex: 1 })),
    ];
    expect(findBusRuns(directSteps).map((r) => r.legIndex)).toEqual([0, 1]);
    const directRoute = { ...route, legs: [leg, leg] };
    const ride = confirmBoarded(required(advance().ride), 2000);
    const result = advance({
      instructions: directSteps,
      route: directRoute,
      cp: buildCumulativePath(directRoute.legs),
      ride,
      currentIndex: 1,
      nextIndex: 3,
      alongM: 3000,
    });
    expect(result.nextIndex).toBe(2);
    expect(result.ride?.boarded).toBe(false);
  });
  it("keeps unknown station counts unknown", () => {
    expect(
      rideStops({ ...leg, intermediateStops: undefined }, cp, 0),
    ).toBeNull();
    expect(
      rideStops({ ...leg, intermediateStops: [{ name: "missing" }] }, cp, 0),
    ).toBeNull();
    expect(
      rideStops(
        {
          ...leg,
          intermediateStops: [{ name: "off route", location: [123, 25] }],
        },
        cp,
        0,
      ),
    ).toBeNull();
  });
  it("shows waiting ETA and ride stops with honestly estimated time", () => {
    const input = {
      run: findBusRuns(steps)[0],
      leg,
      boarded: false,
      alongM: 0,
      boardAlongM: 0,
      stops: rideStops(leg, cp, 0),
      legEndAlongM: required(cp.cumM.at(-1)),
      liveMinutes: 0,
    };
    expect(buildTransitGuide(input, 0)).toMatchObject({
      phase: "waiting",
      waitMinutes: 0,
    });
    expect(
      buildTransitGuide({ ...input, boarded: true, liveMinutes: null }, 1),
    ).toMatchObject({
      phase: "riding",
      stopsLeft: 2,
      minutesSource: "estimated",
      minutes: 20,
    });
    expect(
      buildTransitGuide({ ...input, boarded: true, alongM: cp.cumM[1] }, 1),
    ).toMatchObject({ phase: "riding", stopsLeft: 1 });
  });
  it("announces a skipped last stop once (2 → 0), never on null cleanup", () => {
    const ride = {
      phase: "riding",
      routeName: "99",
      alightStop: "C",
      stopsLeft: 2,
      minutes: null,
      minutesSource: null,
    } as const;
    const next = { ...ride, stopsLeft: 0 };
    const first = transitAnnouncement(ride, next, new Set());
    expect(first.speech?.kind).toBe("alight");
    expect(
      transitAnnouncement(ride, next, new Set(first.remember)).speech,
    ).toBeNull();
    expect(transitAnnouncement(next, next, new Set()).speech).toBeNull();
    expect(
      transitAnnouncement(
        { ...ride, stopsLeft: 1 },
        next,
        new Set(first.remember),
      ).speech,
    ).toBeNull();
    expect(transitAnnouncement(ride, null, new Set()).speech).toBeNull();
  });
  it("deduplicates waiting thresholds and next-stop alight speech", () => {
    const waiting = {
      phase: "waiting",
      routeName: "99",
      boardStop: "A",
      waitMinutes: 3,
    } as const;
    const first = transitAnnouncement(null, waiting, new Set());
    expect(first.speech?.kind).toBe("atStop");
    expect(
      transitAnnouncement(waiting, waiting, new Set(first.remember)).speech,
    ).toBeNull();
    const ride = {
      phase: "riding",
      routeName: "99",
      alightStop: "C",
      stopsLeft: 2,
      minutes: null,
      minutesSource: null,
    } as const;
    const next = { ...ride, stopsLeft: 1 };
    expect(transitAnnouncement(ride, next, new Set()).speech?.kind).toBe(
      "nextStopAlight",
    );
    expect(transitAnnouncement(next, next, new Set()).speech).toBeNull();
    const saidNext = transitAnnouncement(ride, next, new Set());
    expect(
      transitAnnouncement(ride, next, new Set(saidNext.remember)).speech,
    ).toBeNull();
    const boarded = transitAnnouncement(null, next, new Set());
    expect(
      transitAnnouncement(null, next, new Set(boarded.remember)).speech,
    ).toBeNull();
  });
});
describe("manual and boarding ownership", () => {
  it("provides readable English plural and Chinese defaults before dictionary integration", () => {
    expect(navigationCopyDefault("en", "navBusStopsLeft", 1)).toBe(
      "{{count}} stop left",
    );
    expect(navigationCopyDefault("en", "navBusStopsLeft", 2)).toBe(
      "{{count}} stops left",
    );
    expect(navigationCopyDefault("zh-TW", "navBusStopsLeft", 2)).toBe(
      "還有 {{count}} 站",
    );
  });
  it("preview cannot speak, and live speech remains subject to voice ownership", () => {
    expect(
      shouldSpeakLocally({
        geminiOwnsSpeech: false,
        localVoiceEnabled: true,
        localNavigationMode: "preview",
      }),
    ).toBe(false);
    expect(
      shouldSpeakLocally({
        geminiOwnsSpeech: false,
        localVoiceEnabled: true,
        localNavigationMode: "live",
      }),
    ).toBe(true);
    expect(
      shouldSpeakLocally({
        geminiOwnsSpeech: true,
        localVoiceEnabled: true,
        localNavigationMode: "live",
      }),
    ).toBe(false);
  });
  it("starting the voice map UI preserves the authoritative owner and installed steps", () => {
    useMapStore.setState({
      selectRoute: { index: 0, route },
      isNavigating: false,
      invalidRouteTokens: [],
    });
    const nav = useNavStore.getState();
    nav.setNavigationSource("voice");
    nav.setInstructions(steps);
    nav.setCurrentStepIndex(1);
    startNavigation();
    expect(useNavStore.getState().navigationSource).toBe("voice");
    expect(useNavStore.getState().instructions).toBe(steps);
    expect(useNavStore.getState().currentStepIndex).toBe(1);
    stopNavigation();
  });
  it("permits manual preview, resets its projection before live, and blocks live/voice manual changes", () => {
    const nav = useNavStore.getState();
    nav.setInstructions(steps);
    nav.setStepIndex(1);
    expect(useNavStore.getState().currentStepIndex).toBe(1);
    nav.promoteToLive();
    expect(useNavStore.getState().currentStepIndex).toBe(0);
    nav.setStepIndex(1);
    expect(useNavStore.getState().currentStepIndex).toBe(0);
    nav.setNavigationSource("voice");
    nav.setStepIndex(1);
    expect(useNavStore.getState().currentStepIndex).toBe(0);
    expect(useNavStore.getState().transitRide).toBeNull();
  });
  it("only accepts explicit boarding in a local live waiting run", () => {
    const ride = newTransitRide("run");
    const guide = {
      phase: "waiting",
      routeName: "99",
      boardStop: "A",
      waitMinutes: null,
    } as const;
    const nav = useNavStore.getState();
    nav.setTransitRide(ride, guide);
    nav.confirmBusBoarded();
    expect(useNavStore.getState().transitRide?.boarded).toBe(false);
    nav.promoteToLive();
    nav.confirmBusBoarded();
    expect(useNavStore.getState().transitRide?.boarded).toBe(true);
    nav.setNavigationSource("voice");
    expect(useNavStore.getState().transitRide).toBeNull();
    nav.reset();
    expect(useNavStore.getState().navigationMode).toBe("preview");
  });
});
