import {
  type ComponentProps,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  buttons: [] as { onClick?: () => Promise<void>; disabled?: boolean }[],
  cards: [] as ComponentProps<"div">[],
  start: vi.fn(),
  showPlace: vi.fn(),
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
    i18n: { language: "zh-TW" },
  }),
}));
vi.mock("@/lib/navigation/navigationLifecycle", async (original) => {
  const actual =
    await original<typeof import("@/lib/navigation/navigationLifecycle")>();
  return {
    ...actual,
    startNavigation: () => {
      h.start();
      return actual.startNavigation();
    },
  };
});
vi.mock("next/dynamic", () => ({
  default: (loader: () => unknown) => {
    const name = loader
      .toString()
      .match(/(EnvironmentPanel|HazardReportPanel|RouteExplanationPanel)/)?.[1];
    return () => <div>{name}</div>;
  },
}));
vi.mock("../VenueJourneyContent", () => ({
  default: () => <div>legacy-venue-result</div>,
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: ComponentProps<"button">) => {
    h.buttons.push({
      onClick: onClick as (() => Promise<void>) | undefined,
      disabled: props.disabled,
    });
    return (
      <button {...props} onClick={onClick}>
        {children}
      </button>
    );
  },
}));
vi.mock("@/components/ui/card", async (original) => {
  const actual = await original<typeof import("@/components/ui/card")>();
  return {
    ...actual,
    Card: ({ children, ...props }: ComponentProps<"div">) => {
      h.cards.push(props);
      return <div {...props}>{children}</div>;
    },
  };
});

import type { VenueJourney } from "@/lib/indoor/journey";
import type { LocalIndoorModel } from "@/lib/indoor/types";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import type { VenuePlaceDetail } from "@/types";
import type { AccessibleRoute } from "@/types/route";
import RouteContent from "../RouteContent";

const classroom: VenuePlaceDetail = {
  kind: "venue-place",
  name: "Room Alpha",
  address: "Building A 3F Room Alpha",
  buildingId: "a",
  buildingName: "Building A",
  levelRef: "3F",
  placeId: "room-a",
  venueId: "synthetic-venue",
  sourceVersion: "synthetic-source",
  dataSource: "local",
  arrivalKind: "corridor",
  position: { lat: 10.0002, lng: 10.0002 },
};
const gate = {
  ...classroom,
  name: "Source Gate",
  placeId: "gate",
  buildingId: null,
  levelRef: null,
  arrivalKind: "place" as const,
  position: { lat: 10, lng: 10 },
};
const primary: AccessibleRoute = {
  routeId: "bus-route",
  routeName: "Bus candidate",
  routeToken: "bus-token",
  navigationId: "bus-navigation",
  routeVersion: 1,
  departureTime: "2026-10-21T21:05:00+08:00",
  arrivalTime: "2026-10-21T21:28:00+08:00",
  totalMinutes: 23,
  transferCount: 0,
  accessibilityHighlights: [],
  legs: [
    {
      type: "BUS",
      routeName: "Synthetic 99",
      departureStop: "Stop Start",
      arrivalStop: "Stop End",
      departureStopUid: "stop-a",
      arrivalStopUid: "stop-b",
      rideMinutes: 20,
      stopsCount: 3,
      waitInfo: { source: "schedule", time: "21:08" },
      polyline: [
        [9.9, 9.9],
        [9.99, 10],
      ],
    },
    {
      type: "WALK",
      from: "Stop End",
      to: "10,10",
      distanceM: 300,
      minutesEst: 3,
      a11yFacilities: [],
      polyline: [
        [9.99, 10],
        [10, 10],
      ],
      steps: [],
    },
  ] as AccessibleRoute["legs"],
};
const alternate: AccessibleRoute = {
  ...primary,
  routeId: "second-route",
  routeName: "Second candidate",
  departureTime: "2026-10-21T21:15:00+08:00",
  arrivalTime: "2026-10-21T21:38:00+08:00",
  routeToken: "second-token",
  navigationId: "second-navigation",
};
function journey(outdoor = true): VenueJourney {
  return {
    id: "synthetic-journey",
    venueId: classroom.venueId,
    buildingId: "a",
    sourceVersion: classroom.sourceVersion,
    from: gate,
    to: classroom,
    mode: "normal",
    verticalPreference: "auto",
    preview: { progress: 0, playing: false, direction: 1 },
    guidance: { status: "idle", stepIndex: 0 },
    route: {
      ok: true,
      fromPlaceId: gate.placeId,
      toPlaceId: classroom.placeId,
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
      kinds: ["corridor"],
      distanceM: 80,
      animationSafe: true,
      warnings: [],
      edgeIds: ["source-edge"],
      steps: [
        {
          kind: "corridor",
          name: "Source corridor",
          fromLevel: "1F",
          toLevel: "1F",
          distanceM: 80,
          startIndex: 0,
          endIndex: 1,
          heightPending: false,
        },
      ],
    },
    ...(outdoor
      ? {
          outdoor: {
            origin: {
              kind: "coordinate" as const,
              address: "Selected origin",
              position: { lat: 9.9, lng: 9.9 },
            },
            routes: [primary, alternate],
            selectedIndex: 0,
            arrival: gate,
          },
        }
      : {}),
  };
}
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children as ReactNode)];
}
function render() {
  const tree = RouteContent();
  return { tree, markup: renderToStaticMarkup(tree), nodes: elements(tree) };
}

beforeEach(() => {
  h.buttons.length = 0;
  h.cards.length = 0;
  h.start.mockClear();
  h.showPlace.mockClear();
  useNavStore.getState().reset();
  useMapStore.setState({
    map: null,
    routeSubPanel: "none",
    invalidRouteTokens: [],
    userLocation: null,
    isNavigating: false,
  });
  useIndoorCatalog.setState({
    models: [
      {
        venueId: classroom.venueId,
        building: { id: "a" },
        source: { sha256: classroom.sourceVersion },
        places: [{ id: gate.placeId }, { id: classroom.placeId }],
      },
    ] as LocalIndoorModel[],
    showPlace: h.showPlace,
  });
  useMapStore.getState().setVenueJourney(journey());
  vi.stubGlobal("DeviceOrientationEvent", {});
});
afterEach(() => vi.unstubAllGlobals());

describe("venue journeys retain the existing route-results interface", () => {
  it("renders the real bus RouteCard with journey times, schedule, walk detail and original actions", () => {
    const { markup } = render();
    for (const text of [
      "routeResultsTitle",
      "startNav",
      "aiExplanation",
      "environment",
      "reportHazard",
      "routeJourneyDeparture",
      "routeJourneyArrival",
      "Synthetic 99",
      "21:08",
      "Stop Start",
      "Stop End",
      "Building A",
      "3F",
      "Room Alpha",
    ])
      expect(markup).toContain(text);
    const clocks = Array.from(
      markup.matchAll(/<time\b[^>]*dateTime="([^"]+)"[^>]*>([^<]+)<\/time>/g),
      ([, instant, clock]) => [instant, clock],
    );
    expect(clocks).toEqual([
      ["2026-10-21T21:05:00+08:00", "21:05"],
      ["2026-10-21T21:28:00+08:00", "21:28"],
      ["2026-10-21T21:15:00+08:00", "21:15"],
      ["2026-10-21T21:38:00+08:00", "21:38"],
    ]);
    expect(markup).not.toContain("legacy-venue-result");
    expect(markup.match(/<h1/g)).toHaveLength(1);
    expect(h.cards).toHaveLength(2);
  });

  it("selects the original candidate object through RouteCard and preserves the active navigation owner", () => {
    const value = journey();
    if (!value.outdoor) throw new Error("Expected fixture");
    value.outdoor.navigationIndex = 0;
    useMapStore.getState().setVenueJourney(value);
    useMapStore.setState({
      activeNavigationRoute: primary,
      isNavigating: true,
    });
    render();
    h.cards
      .find((card) => card["aria-label"] === "selectRoute: Second candidate")
      ?.onClick?.({} as never);
    expect(useMapStore.getState().selectRoute?.route).toBe(alternate);
    expect(useMapStore.getState().venueJourney?.outdoor?.selectedIndex).toBe(1);
    expect(useMapStore.getState().venueJourney?.outdoor?.navigationIndex).toBe(
      0,
    );
    expect(useMapStore.getState().activeNavigationRoute).toBe(primary);
  });

  it("keeps the original orientation-permission start flow", async () => {
    const requestPermission = vi.fn(async () => "granted");
    vi.stubGlobal("DeviceOrientationEvent", { requestPermission });
    render();
    await h.buttons.find((button) => !button.disabled)?.onClick?.();
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(h.start).toHaveBeenCalledOnce();
    expect(useNavStore.getState().compassPermission).toBe("granted");
    expect(useMapStore.getState().activeNavigationRoute).toBe(primary);
  });

  it("returns to the original planning form with both endpoints retained", () => {
    const origin = useMapStore.getState().origin;
    const { nodes } = render();
    const back = nodes.find(
      (node) => node.type === "button" && node.props["aria-label"] === "back",
    );
    if (!back) throw new Error("Missing original back button");
    (back.props.onClick as () => void)();
    expect(useMapStore.getState()).toMatchObject({
      venueJourney: null,
      computeRoutes: null,
      selectRoute: null,
      sheetMode: "plan",
      origin,
      destination: classroom,
    });
  });

  it.each(["explanation", "environment", "hazard"] as const)(
    "opens the original %s subpanel for a mixed journey",
    (panel) => {
      const label = {
        explanation: "aiExplanation",
        environment: "environment",
        hazard: "reportHazard",
      }[panel];
      const action = render().nodes.find(
        (node) =>
          node.type === "button" &&
          Array.isArray(node.props.children) &&
          node.props.children.includes(label),
      );
      if (!action) throw new Error(`Missing original ${panel} action`);
      (action.props.onClick as () => void)();
      const { markup } = render();
      expect(markup).toContain(
        {
          explanation: "RouteExplanationPanel",
          environment: "EnvironmentPanel",
          hazard: "HazardReportPanel",
        }[panel],
      );
      expect(markup).not.toContain("legacy-venue-result");
    },
  );

  it.each(["DRIVE", "WALK"] as const)(
    "labels the %s primary's true handoff without relabelling it as the classroom or changing source route data",
    (type) => {
      const value = journey();
      if (!value.outdoor) throw new Error("Expected fixture");
      const original = {
        ...primary,
        routeName: "Primary candidate",
        legs: [
          {
            type,
            from: { lat: 9.9, lng: 9.9 },
            to: { lat: 10, lng: 10 },
            polyline: [
              [9.9, 9.9],
              [10, 10],
            ],
            distanceM: 100,
            durationMin: 2,
            minutesEst: 2,
            a11yFacilities: [],
          },
        ] as unknown as AccessibleRoute["legs"],
      };
      const before = JSON.stringify(original);
      value.outdoor.routes = [original];
      value.outdoor.approachRoutes = {
        "bus-token": {
          ...original,
          routeToken: "separate-tail-token",
          totalMinutes: 1,
          legs: [
            {
              type: "WALK",
              from: "Handoff",
              to: "Gate",
              polyline: [
                [10, 10],
                [10.0001, 10],
              ],
              distanceM: 11,
              minutesEst: 1,
              a11yFacilities: [],
            },
          ],
        },
      };
      useMapStore.getState().setVenueJourney(value);
      const { markup, nodes } = render();
      const card = nodes.find((node) => node.props.route === original);
      expect(card?.props.destinationDisplay).toEqual({
        position: { lat: 10, lng: 10 },
        name: type === "DRIVE" ? "venueDropOffPoint" : "venueWalkHandoffPoint",
      });
      if (type === "DRIVE")
        expect(markup).toContain("Selected origin → venueDropOffPoint");
      expect(markup).not.toContain("Selected origin → Room Alpha");
      expect(markup).toContain("routeOutdoorSection");
      expect(markup).toContain("venueApproachDistance");
      expect(markup).toContain("viewWalkSteps");
      expect(markup).toContain("venueArriveAtCorridor Room Alpha");
      expect(markup).not.toContain("<details");
      expect(JSON.stringify(original)).toBe(before);
      expect(useMapStore.getState().selectRoute?.route).toBe(original);
      expect(useMapStore.getState().destination).toEqual(classroom);
    },
  );

  it("assigns each original candidate its own token-keyed walking continuation and changes only the preview on selection", () => {
    const value = journey();
    if (!value.outdoor) throw new Error("Expected fixture");
    const tail = (token: string, streetName: string): AccessibleRoute => ({
      ...primary,
      routeId: token,
      routeToken: token,
      legs: [
        {
          type: "WALK",
          from: "Handoff",
          to: "Gate",
          distanceM: 55,
          minutesEst: 2,
          a11yFacilities: [],
          polyline: [
            [10, 10],
            [10.0001, 10],
          ],
          steps: [
            {
              relativeDirection: "LEFT",
              absoluteDirection: null,
              streetName,
              bogusName: false,
              area: false,
              stairs: false,
              steepSlope: false,
              distanceM: 55,
              location: [10, 10],
            },
          ],
        },
      ],
    });
    const a = tail("tail-token-a", "TailAlphaRoad");
    const b = tail("tail-token-b", "TailBetaRoad");
    value.outdoor.approachRoutes = { "bus-token": a, "second-token": b };
    value.outdoor.navigationIndex = 0;
    useMapStore.getState().setVenueJourney(value);
    useMapStore.setState({
      activeNavigationRoute: primary,
      isNavigating: true,
    });
    const before = JSON.stringify({ primary, alternate, a, b });
    const { markup, nodes } = render();
    expect(markup).toContain("TailAlphaRoad");
    expect(markup).not.toContain("TailBetaRoad");
    for (const [candidate, expected] of [
      [primary, a],
      [alternate, b],
    ] as const) {
      const card = nodes.find((node) => node.props.route === candidate);
      const continuation = card?.props.walkingContinuation as {
        summary: ReactElement<{ approach: AccessibleRoute }>;
        steps: ReactElement<{ approach: AccessibleRoute }>;
      };
      expect(continuation.summary.props.approach).toBe(expected);
      expect(continuation.steps.props.approach).toBe(expected);
    }
    h.cards
      .find((card) => card["aria-label"] === "selectRoute: Second candidate")
      ?.onClick?.({} as never);
    const next = render().markup;
    expect(next).toContain("TailBetaRoad");
    expect(next).not.toContain("TailAlphaRoad");
    expect(useMapStore.getState().selectRoute?.route).toBe(alternate);
    expect(useMapStore.getState().venueJourney?.outdoor).toMatchObject({
      selectedIndex: 1,
      navigationIndex: 0,
    });
    expect(useMapStore.getState().activeNavigationRoute).toBe(primary);
    expect(JSON.stringify({ primary, alternate, a, b })).toBe(before);
  });

  it("preserves the ordinary outdoor page and token-expiry start guard", () => {
    useMapStore.getState().setComputeRoutes([primary]);
    useMapStore.getState().setRouteSelect({ index: 0, route: primary });
    useMapStore.getState().invalidateRouteToken("bus-token");
    const { markup } = render();
    expect(markup).toContain("routeTokenExpired");
    expect(markup).toContain("Synthetic 99");
    expect(markup).not.toContain("venueWalkDistance");
    expect(markup).not.toContain("routeOutdoorSection");
    expect(h.buttons[0].disabled).toBe(true);
  });

  it("shows a multi-floor stair run as one direct indoor instruction", () => {
    const value = journey(false);
    value.route.steps = [
      ["1F", "2F", 0, 1],
      ["2F", "3F", 1, 2],
      ["3F", "4F", 2, 3],
    ].map(([fromLevel, toLevel, startIndex, endIndex], index) => ({
      kind: "steps" as const,
      name: "樓梯",
      fromLevel: String(fromLevel),
      toLevel: String(toLevel),
      distanceM: 10,
      startIndex: Number(startIndex),
      endIndex: Number(endIndex),
      heightPending: false,
      buildingId: "a",
      connectionId: `stairs-${index}`,
    }));
    const before = JSON.stringify(value.route.steps);
    useMapStore.getState().setVenueJourney(value);
    const { markup } = render();
    expect(markup.match(/venueStepUp/g)).toHaveLength(1);
    expect(markup).toContain("4F");
    expect(markup).not.toContain("2F");
    expect(JSON.stringify(value.route.steps)).toBe(before);
  });

  it("starts an indoor-only route in the same result view without creating a backend route or token", async () => {
    useMapStore.getState().setVenueJourney(journey(false));
    const { markup } = render();
    expect(markup).toContain("routeResultsTitle");
    expect(markup).toContain("startNav");
    expect(markup).toContain("Source corridor");
    expect(markup).toContain("environment");
    expect(markup).toContain("reportHazard");
    expect(markup).not.toContain("aiExplanation");
    expect(markup).toContain("venueArriveAt");
    await h.buttons.find((button) => !button.disabled)?.onClick?.();
    expect(h.start).toHaveBeenCalledOnce();
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe(
      "touring",
    );
    expect(useMapStore.getState().computeRoutes).toBeNull();
    expect(useMapStore.getState().activeNavigationRoute).toBeNull();
    expect(useNavStore.getState().navigationId).toBeNull();
  });
});
