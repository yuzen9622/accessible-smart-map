import {
  type ComponentProps,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  open: false,
  language: "en" as "en" | "zh-TW",
  legs: [] as {
    leg: unknown;
    routeToken?: string;
    routeIndex?: number;
    legIndex?: number;
    walkingContinuation?: unknown;
  }[],
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: () => [
    h.open,
    (next: boolean | ((value: boolean) => boolean)) => {
      h.open = typeof next === "function" ? next(h.open) : next;
    },
  ],
}));
vi.mock("zustand/react/shallow", () => ({
  useShallow: (selector: unknown) => selector,
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
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      [key, ...Object.values(values ?? {})].join(" "),
    i18n: { language: h.language },
  }),
}));
vi.mock("@/i18n/language", () => ({ getAppLanguage: () => h.language }));
vi.mock("../RouteCard/LegDetail", async (original) => {
  const actual = await original<typeof import("../RouteCard/LegDetail")>();
  return {
    ...actual,
    LegDetail: (props: ComponentProps<typeof actual.LegDetail>) => {
      h.legs.push(props);
      return (
        <section data-test-leg={props.legIndex}>
          <actual.LegDetail {...props} />
        </section>
      );
    },
  };
});

import type { VenueJourney } from "@/lib/indoor/journey";
import useMapStore from "@/stores/useMapStore";
import type { AccessibleRoute, BusLeg, WalkLeg, WalkStep } from "@/types/route";
import { RouteCard } from "../RouteCard/RouteCard";
import {
  VenueWalkSteps,
  VenueWalkSummary,
} from "../RouteCard/VenueWalkContinuation";
import {
  type WalkingContinuation,
  WalkStepsList,
} from "../RouteCard/WalkStepsList";

function step(streetName: string): WalkStep {
  return {
    relativeDirection: "LEFT",
    absoluteDirection: null,
    streetName,
    bogusName: false,
    area: false,
    stairs: false,
    steepSlope: false,
    distanceM: 7,
    location: [10, 10],
  };
}
function walk(name: string, steps: WalkStep[] = []): WalkLeg {
  return {
    type: "WALK",
    from: name,
    to: `${name}-end`,
    distanceM: 7,
    minutesEst: 1,
    a11yFacilities: [],
    polyline: [
      [10, 10],
      [10.0001, 10],
    ],
    steps,
  };
}
const bus: BusLeg = {
  type: "BUS",
  routeName: "Synthetic Bus",
  departureStop: "Stop A",
  arrivalStop: "Stop B",
  departureStopId: "a",
  arrivalStopId: "b",
  estimatedWaitMinutes: 1,
  direction: 0,
  departureStopA11y: [],
  arrivalStopA11y: [],
  waitInfo: { source: "schedule", time: "12:34" },
  polyline: [
    [10, 10],
    [10.001, 10],
  ],
};
function route(legs: AccessibleRoute["legs"]): AccessibleRoute {
  return {
    routeId: "primary-source",
    routeName: "Primary",
    routeToken: "primary-token",
    totalMinutes: 12,
    transferCount: 0,
    accessibilityHighlights: [],
    legs,
  };
}
const continuation: WalkingContinuation = {
  destinationName: "Room Alpha",
  summary: <span>INDOOR-SUMMARY</span>,
  steps: <li>INDOOR-CONTINUATION</li>,
};
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function renderWalkList(props: ComponentProps<typeof WalkStepsList>) {
  let tree: ReactNode = null;
  function Probe() {
    tree = WalkStepsList(props);
    return tree;
  }
  const markup = renderToStaticMarkup(<Probe />);
  return { markup, nodes: elements(tree) };
}

beforeEach(() => {
  h.open = false;
  h.legs.length = 0;
  h.language = "en";
  useMapStore.setState({
    map: null,
    venueJourney: null,
    origin: null,
    destination: null,
    userLocation: null,
    routeSubPanel: "none",
    activeBusLeg: null,
    liveBusPositions: [],
  });
});

describe("walk continuation stays inside the existing route timeline", () => {
  it("attaches only to the last actual walking leg after transit, preserving provider tokens and original leg indexes", () => {
    const primary = route([
      walk("Before bus", [step("Initial road")]),
      bus,
      walk("After bus"),
    ]);
    const before = JSON.stringify(primary);
    useMapStore.setState({ selectRoute: { index: 4, route: primary } });
    const markup = renderToStaticMarkup(
      <RouteCard route={primary} idx={4} walkingContinuation={continuation} />,
    );
    expect(
      h.legs.map((leg) => ({
        token: leg.routeToken,
        route: leg.routeIndex,
        leg: leg.legIndex,
      })),
    ).toEqual(
      [0, 1, 2].map((leg) => ({ token: "primary-token", route: 4, leg })),
    );
    expect(h.legs.map((leg) => leg.leg)).toEqual(primary.legs);
    expect(h.legs[0].walkingContinuation).toBeUndefined();
    expect(h.legs[1].walkingContinuation).toBeUndefined();
    expect(h.legs[2].walkingContinuation).toBe(continuation);
    expect(markup.match(/INDOOR-CONTINUATION/g)).toHaveLength(1);
    expect(markup.indexOf("INDOOR-CONTINUATION")).toBeGreaterThan(
      markup.indexOf('data-test-leg="2"'),
    );
    expect(JSON.stringify(primary)).toBe(before);
  });

  it("does not attach to an earlier walk when the primary ends by driving; uses a display-only timeline slot", () => {
    const primary = route([
      walk("Before drive"),
      {
        type: "DRIVE",
        from: "Road start",
        to: "Drop-off",
        distanceM: 100,
        durationMin: 2,
        polyline: [
          [10, 10],
          [10.001, 10],
        ],
      },
    ]);
    const before = JSON.stringify(primary);
    useMapStore.setState({ selectRoute: { index: 0, route: primary } });
    const markup = renderToStaticMarkup(
      <RouteCard route={primary} idx={0} walkingContinuation={continuation} />,
    );
    expect(h.legs).toHaveLength(2);
    expect(h.legs.every((leg) => leg.walkingContinuation === undefined)).toBe(
      true,
    );
    expect(h.legs.map((leg) => leg.legIndex)).toEqual([0, 1]);
    expect(h.legs.every((leg) => leg.routeToken === "primary-token")).toBe(
      true,
    );
    expect(markup.match(/INDOOR-CONTINUATION/g)).toHaveLength(1);
    expect(markup.indexOf("INDOOR-CONTINUATION")).toBeGreaterThan(
      markup.indexOf("Drop-off"),
    );
    expect(JSON.stringify(primary)).toBe(before);
    expect(primary.legs).toHaveLength(2);
  });

  it("offers the same expandable walking-details control without provider steps and leaves the route owner unchanged", () => {
    const primary = route([walk("Source walk")]);
    useMapStore.setState({
      selectRoute: { index: 0, route: primary },
      activeNavigationRoute: primary,
    });
    const before = useMapStore.getState();
    let view = renderWalkList({ steps: [], continuation: continuation.steps });
    const toggle = view.nodes.find((node) => node.type === "button");
    expect(toggle?.props["aria-expanded"]).toBe(false);
    expect(view.markup).toContain("viewWalkSteps");
    if (!toggle) throw new Error("Missing walking-details toggle");
    (toggle.props.onClick as () => void)();
    view = renderWalkList({ steps: [], continuation: continuation.steps });
    expect(
      view.nodes.find((node) => node.type === "button")?.props["aria-expanded"],
    ).toBe(true);
    expect(view.markup).toContain("INDOOR-CONTINUATION");
    expect(useMapStore.getState()).toBe(before);
    expect(renderWalkList({ steps: [] }).markup).toBe("");
  });
});

describe("real approach details retain per-leg street-name indexes", () => {
  const place = {
    kind: "venue-place" as const,
    name: "Room Alpha",
    address: "Building A 3F",
    venueId: "synthetic",
    buildingId: "a",
    buildingName: "Building A",
    levelRef: "3F",
    placeId: "room",
    sourceVersion: "source",
    dataSource: "local" as const,
    arrivalKind: "corridor" as const,
    position: { lat: 10, lng: 10 },
  };
  const journey: VenueJourney = {
    id: "journey",
    venueId: "synthetic",
    buildingId: "a",
    sourceVersion: "source",
    from: {
      ...place,
      name: "Gate",
      placeId: "gate",
      buildingId: null,
      levelRef: null,
    },
    to: place,
    mode: "normal",
    verticalPreference: "auto",
    preview: { progress: 0, playing: false, direction: 1 },
    guidance: { status: "idle", stepIndex: 0 },
    route: {
      ok: true,
      fromPlaceId: "gate",
      toPlaceId: "room",
      points: [
        [0, 0, 0],
        [0, 0, 7.2],
      ],
      kinds: ["elevator"],
      distanceM: 27,
      animationSafe: true,
      warnings: [],
      edgeIds: ["source"],
      steps: [
        {
          kind: "elevator",
          name: "Lift A",
          fromLevel: "1F",
          toLevel: "3F",
          distanceM: 7.2,
          startIndex: 0,
          endIndex: 1,
          heightPending: false,
        },
      ],
    },
  };

  it("uses the actual localized steps of both independent approach legs, followed by the actual indoor lift", () => {
    const approach = route([
      {
        ...walk("tail-one", [step("甲路")]),
        displayLanguage: "en",
        stepStreetNames: [
          {
            index: 0,
            streetName: "甲路",
            nameEn: "Road Alpha",
            displayName: "Alpha Display",
          },
        ],
      },
      {
        ...walk("tail-two", [step("乙路")]),
        displayLanguage: "en",
        stepStreetNames: [
          {
            index: 0,
            streetName: "乙路",
            nameEn: "Road Beta",
            displayName: "Beta Display",
          },
        ],
      },
    ]);
    const before = JSON.stringify({ journey, approach });
    const markup = renderToStaticMarkup(
      <ul>
        <VenueWalkSteps journey={journey} approach={approach} />
      </ul>,
    );
    expect(markup).toContain("Alpha Display");
    expect(markup).toContain("Beta Display");
    expect(markup.match(/Alpha Display/g)).toHaveLength(1);
    expect(markup.match(/Beta Display/g)).toHaveLength(1);
    expect(markup).toContain("Lift A");
    expect(markup).toContain("3F");
    expect(markup.indexOf("Beta Display")).toBeLessThan(
      markup.indexOf("Lift A"),
    );
    const summary = renderToStaticMarkup(
      <VenueWalkSummary journey={journey} approach={approach} />,
    );
    expect(summary).toContain("Building A · 3F");
    expect(summary).toContain("venueWalkDistance");
    expect(summary).toContain("venueApproachDistance");
    expect(JSON.stringify({ journey, approach })).toBe(before);
  });

  it("does not claim gate arrival at each intermediate approach leg when provider steps are absent", () => {
    const approach = route([walk("first-connector"), walk("second-connector")]);
    const markup = renderToStaticMarkup(
      <ul>
        <VenueWalkSteps journey={journey} approach={approach} />
      </ul>,
    );
    expect(markup.match(/Gate/g)).toHaveLength(1);
    expect(markup).toContain("venueArriveAt Gate");
    expect(markup.match(/walk ·/g)).toHaveLength(2);
    expect(markup.indexOf("venueArriveAt Gate")).toBeGreaterThan(
      markup.lastIndexOf("walk ·"),
    );
    expect(markup).toContain("venueArriveAtCorridor Room Alpha");
  });
});
