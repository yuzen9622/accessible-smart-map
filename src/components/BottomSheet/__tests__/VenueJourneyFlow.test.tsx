import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  language: "zh-TW",
  buttons: [] as { onClick?: () => unknown; label?: string }[],
  inputs: [] as { onPlaceSelect?: (place: unknown) => void }[],
  states: [] as unknown[],
  stateCursor: 0,
  plan: vi.fn(),
  showPlace: vi.fn(),
  startApproach: vi.fn(),
  confirmArrival: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = h.stateCursor++;
    if (!(index in h.states))
      h.states[index] = typeof initial === "function" ? initial() : initial;
    return [
      h.states[index],
      (value: unknown) => {
        h.states[index] =
          typeof value === "function" ? value(h.states[index]) : value;
      },
    ];
  },
}));
vi.mock("@/stores/useMapStore", async (original) => {
  const actual = await original<typeof import("@/stores/useMapStore")>();
  return {
    ...actual,
    default: Object.assign(
      (
        select: (state: ReturnType<typeof actual.default.getState>) => unknown,
      ) => select(actual.default.getState()),
      actual.default,
    ),
  };
});
vi.mock("@/stores/useIndoorCatalog", async (original) => {
  const actual = await original<typeof import("@/stores/useIndoorCatalog")>();
  return {
    ...actual,
    default: Object.assign(
      (
        select: (state: ReturnType<typeof actual.default.getState>) => unknown,
      ) => select(actual.default.getState()),
      actual.default,
    ),
  };
});
vi.mock("@/stores/useNavStore", async (original) => {
  const actual = await original<typeof import("@/stores/useNavStore")>();
  return {
    ...actual,
    default: Object.assign(
      (
        select: (state: ReturnType<typeof actual.default.getState>) => unknown,
      ) => select(actual.default.getState()),
      actual.default,
    ),
  };
});
vi.mock("@/i18n/client", async () => {
  const { default: dictionary } = await import(
    "@/i18n/locale/zh-TW/translation.json"
  );
  const { default: english } = await import(
    "@/i18n/locale/en/translation.json"
  );
  return {
    useAppTranslation: () => ({
      t: (key: string, values?: Record<string, unknown>) => {
        const translated = (
          (h.language === "en" ? english : dictionary) as Record<
            string,
            unknown
          >
        )[key];
        const text =
          (key.startsWith("venue") || key === "endNav") &&
          typeof translated === "string"
            ? translated
            : key;
        return text.replace(/{{\s*(\w+)\s*}}/g, (match, name) =>
          values?.[name] === undefined ? match : String(values[name]),
        );
      },
      i18n: { language: h.language, resolvedLanguage: h.language },
    }),
  };
});
vi.mock("@/hook/useComputeRoute", () => ({
  default: () => ({ isLoading: false, handleComputeRoute: vi.fn() }),
}));
vi.mock("@/lib/indoor/planJourney", () => ({ planVenueJourney: h.plan }));
vi.mock("@/lib/navigation/navigationLifecycle", async (original) => ({
  ...(await original<typeof import("@/lib/navigation/navigationLifecycle")>()),
  startVenueApproach: h.startApproach,
  confirmVenueArrival: h.confirmArrival,
}));
vi.mock("@/components/shared/PlaceInput", () => ({
  default: (props: { onPlaceSelect?: (place: unknown) => void }) => {
    h.inputs.push(props);
    return <input aria-label="ordinary place search" />;
  },
}));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: ComponentProps<"button">) => {
    h.buttons.push({
      onClick: onClick as (() => unknown) | undefined,
      label: props["aria-label"],
    });
    return (
      <button {...props} onClick={onClick}>
        {children}
      </button>
    );
  },
}));

import type { VenueJourney } from "@/lib/indoor/journey";
import type { LocalIndoorModel } from "@/lib/indoor/types";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import useOnboardingStore from "@/stores/useOnboardingStore";
import type { VenuePlaceDetail } from "@/types";
import type { AccessibleRoute } from "@/types/route";
import RoutePlanContent from "../RoutePlanContent";
import VenueJourneyContent, {
  VenueArrivalConfirmation,
} from "../VenueJourneyContent";

const classroom: VenuePlaceDetail = {
  kind: "venue-place",
  venueId: "synthetic-campus",
  buildingId: "building-a",
  buildingName: "Building A",
  levelRef: "3F",
  placeId: "room-three",
  sourceVersion: "test-revision",
  dataSource: "local",
  arrivalKind: "corridor",
  name: "Classroom Three",
  address: "Building A 3F Classroom Three",
  position: { lat: 1, lng: 1 },
};
const gate: VenuePlaceDetail = {
  ...classroom,
  placeId: "gate",
  name: "Source Gate",
  buildingId: null,
  levelRef: null,
  arrivalKind: "place",
};
const origin = {
  kind: "coordinate" as const,
  address: "Distant origin",
  position: { lat: 0, lng: 0 },
};
function journey(): VenueJourney {
  return {
    id: "test-journey",
    venueId: classroom.venueId,
    buildingId: "building-a",
    sourceVersion: "test-revision",
    from: gate,
    to: classroom,
    mode: "wheelchair",
    verticalPreference: "elevator",
    preview: { progress: 0, playing: false, direction: 1 },
    guidance: { status: "idle", stepIndex: 0 },
    route: {
      ok: true,
      fromPlaceId: "gate",
      toPlaceId: "room-three",
      points: [
        [0, 0, 0],
        [0, 10, 0],
      ],
      kinds: ["corridor"],
      steps: [
        {
          kind: "corridor",
          name: "INTERNAL_HALL_DETAIL",
          fromLevel: "3F",
          toLevel: "3F",
          distanceM: 80,
          startIndex: 0,
          endIndex: 1,
          heightPending: false,
        },
      ],
      distanceM: 80,
      animationSafe: true,
      warnings: [],
      edgeIds: ["source-edge"],
    },
    outdoor: {
      origin,
      arrival: gate,
      selectedIndex: 0,
      routes: [
        {
          routeId: "outdoor-route",
          routeName: "Outdoor route",
          routeToken: "synthetic-token",
          totalMinutes: 5,
          totalWalkDistanceM: 400,
          legs: [],
        } as unknown as AccessibleRoute,
      ],
    },
  };
}

beforeEach(() => {
  h.language = "zh-TW";
  h.buttons.length = 0;
  h.inputs.length = 0;
  h.states.length = 0;
  h.stateCursor = 0;
  h.plan.mockReset().mockResolvedValue({ ok: false, message: "test stopped" });
  h.showPlace.mockClear();
  h.startApproach.mockClear();
  h.confirmArrival.mockClear();
  useMapStore.setState({
    origin,
    originName: origin.address,
    destination: classroom,
    destinationName: classroom.name,
    venueJourney: null,
    isNavigating: false,
    invalidRouteTokens: [],
    userLocation: null,
    indoorExploring: false,
  });
  useIndoorCatalog.setState({
    showPlace: h.showPlace,
    models: [
      {
        venueId: classroom.venueId,
        source: { sha256: classroom.sourceVersion },
        origin: [0, 0],
        building: {
          id: "building-a",
          name: "Building A",
          levels: [{ ordinal: 2, ref: "3F", elevationM: 8 }],
        },
        preview: { gatePlaceIds: ["gate"] },
        connections: [],
        places: [
          {
            id: "gate",
            name: "Source Gate",
            point: [0, 0, 0],
            buildingId: null,
            levelRef: null,
            routeEndpoint: "place",
          },
        ],
      } as unknown as LocalIndoorModel,
    ],
  });
  useOnboardingStore.setState({
    hydrated: true,
    profile: { ...useOnboardingStore.getState().profile, routeMode: "normal" },
  });
  useNavStore.getState().reset();
});

function renderPlan() {
  h.stateCursor = 0;
  h.buttons.length = 0;
  h.inputs.length = 0;
  return renderToStaticMarkup(<RoutePlanContent />);
}

describe("one ordinary route form for campus destinations", () => {
  it("keeps ordinary search and transport controls without gate or vertical-preference pickers", () => {
    const markup = renderPlan();
    expect(markup).toContain("ordinary place search");
    expect(markup).toContain("transportTool");
    expect(markup).not.toContain("選擇校園入口或館外接點");
    expect(markup).not.toContain("樓層間移動");
    expect(markup).not.toContain("走樓梯");
  });

  it.each(["normal", "wheelchair", "elderly", "visual_impaired"] as const)(
    "submits %s with the automatic profile policy and original origin",
    async (mode) => {
      useOnboardingStore.setState({
        profile: { ...useOnboardingStore.getState().profile, routeMode: mode },
      });
      renderPlan();
      await h.buttons.at(-1)?.onClick?.();
      expect(h.plan).toHaveBeenCalledOnce();
      expect(h.plan.mock.calls[0][0]).toMatchObject({
        origin,
        destination: classroom,
        mode,
        verticalPreference: mode === "normal" ? "auto" : "elevator",
      });
    },
  );

  it("selecting a room in the ordinary form does not move the map indoors", () => {
    renderPlan();
    h.inputs[0].onPlaceSelect?.(classroom);
    expect(useMapStore.getState().origin).toEqual(classroom);
    expect(h.showPlace).not.toHaveBeenCalled();
  });

  it("does not restore the removed stair preference when replanning an older journey", async () => {
    const previous = journey();
    previous.mode = "normal";
    previous.verticalPreference = "stairs";
    useMapStore.setState({ venueJourney: previous });
    renderPlan();
    await h.buttons.at(-1)?.onClick?.();
    expect(h.plan.mock.calls[0][0]).toMatchObject({
      mode: "normal",
      verticalPreference: "auto",
    });
  });

  it.each(["transit", "drive", "motorcycle", "walk"] as const)(
    "keeps %s selectable for an outdoor origin and forwards it with the classroom destination",
    async (travelMode) => {
      const markup = renderPlan();
      expect(markup).not.toContain("校園內使用步行或輪椅通路");
      const transport = h.buttons.find((button) => button.label === travelMode);
      expect(transport).toBeDefined();
      transport?.onClick?.();
      renderPlan();
      await h.buttons.at(-1)?.onClick?.();
      expect(h.plan).toHaveBeenCalledOnce();
      expect(h.plan.mock.calls[0][0]).toMatchObject({
        origin,
        destination: classroom,
        travelMode,
        mode: "normal",
        verticalPreference: "auto",
      });
    },
  );

  it("uses current GPS rather than a residual venue origin when deciding transport availability", async () => {
    useMapStore.setState({ origin: null, userLocation: origin.position });
    renderPlan();
    useMapStore.setState({ origin: gate });
    const markup = renderPlan();
    expect(markup).not.toContain("校園內使用步行或輪椅通路");
    h.buttons.find((button) => button.label === "drive")?.onClick?.();
    renderPlan();
    await h.buttons.at(-1)?.onClick?.();
    expect(h.plan.mock.calls[0][0]).toMatchObject({
      origin: { kind: "coordinate", position: origin.position },
      travelMode: "drive",
    });
  });

  it("restores the original outdoor transport choice when editing a journey", async () => {
    const previous = journey();
    previous.mode = "normal";
    if (!previous.outdoor) throw new Error("Expected outdoor fixture");
    Object.assign(previous.outdoor, { travelMode: "motorcycle" });
    useMapStore.setState({ venueJourney: previous });
    renderPlan();
    await h.buttons.at(-1)?.onClick?.();
    expect(h.plan.mock.calls[0][0]).toMatchObject({
      origin,
      destination: classroom,
      travelMode: "motorcycle",
    });
  });
});

describe("outdoor-first journey presentation", () => {
  it("shows real indoor steps after the common journey enters its guiding phase", () => {
    const value = journey();
    value.guidance.status = "guiding";
    useMapStore.setState({ venueJourney: value });
    const markup = renderToStaticMarkup(<VenueJourneyContent />);
    expect(markup).toContain("INTERNAL_HALL_DETAIL");
    expect(markup).toContain("校內路線步驟");
  });

  it("does not offer premature manual gate arrival while still far outside", () => {
    const value = journey();
    value.guidance.status = "outdoor";
    useMapStore.setState({ venueJourney: value });
    const markup = renderToStaticMarkup(<VenueArrivalConfirmation />);
    expect(markup).toBe("");
    expect(h.buttons).toHaveLength(0);
    useNavStore.getState().setArrived(true);
    expect(renderToStaticMarkup(<VenueArrivalConfirmation />)).toContain(
      "接續校內引導",
    );
  });
});

describe("real final walk after parking is a separate navigation stage", () => {
  function drivingJourney(phase: "travel" | "approach" = "travel") {
    const value = journey();
    if (!value.outdoor) throw new Error("Expected outdoor fixture");
    value.outdoor.routes[0] = {
      ...value.outdoor.routes[0],
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
    Object.assign(value.outdoor, {
      travelMode: "drive",
      phase,
      approachRoutes: {
        "synthetic-token": {
          ...value.outdoor.routes[0],
          routeId: "source-walk-route",
          routeToken: "independent-walk-token",
          totalWalkDistanceM: 19,
          totalMinutes: 1,
        },
      },
    });
    return value;
  }

  it("offers the real walk stage after parking instead of claiming gate arrival", () => {
    const value = drivingJourney();
    value.guidance.status = "outdoor";
    useMapStore.setState({ venueJourney: value });
    useNavStore.getState().setArrived(true);
    const markup = renderToStaticMarkup(<VenueArrivalConfirmation />);
    expect(markup).toContain("已下車，繼續前往校門");
    expect(markup).not.toContain("接續校內引導</button>");
    h.buttons.at(-1)?.onClick?.();
    expect(h.startApproach).toHaveBeenCalledOnce();
    expect(h.confirmArrival).not.toHaveBeenCalled();
  });

  it("keeps gate confirmation unavailable until the separate approach finishes", () => {
    const value = drivingJourney("approach");
    value.guidance.status = "outdoor";
    useMapStore.setState({ venueJourney: value });
    let markup = renderToStaticMarkup(<VenueArrivalConfirmation />);
    expect(markup).toBe("");
    expect(h.buttons).toHaveLength(0);
    useNavStore.getState().setArrived(true);
    markup = renderToStaticMarkup(<VenueArrivalConfirmation />);
    expect(markup).toContain("接續校內引導");
    h.buttons.at(-1)?.onClick?.();
    expect(h.confirmArrival).toHaveBeenCalledOnce();
    expect(h.startApproach).not.toHaveBeenCalled();
  });
});

describe("route animation in the original navigation panel", () => {
  const renderTour = () => {
    h.buttons.length = 0;
    return renderToStaticMarkup(<VenueJourneyContent />);
  };
  const begin = () => {
    const value = journey();
    delete value.outdoor;
    value.route.animationSafe = false;
    value.route.steps[0].heightPending = true;
    useMapStore.getState().setVenueJourney(value);
    useMapStore.getState().startVenueTour();
    return value;
  };
  it("keeps route animation on without playback or step-highlight controls", () => {
    const value = begin();
    const source = JSON.stringify(value.route);
    const markup = renderTour();
    expect(markup).toContain(value.to.name);
    expect(markup).toContain("結束導航");
    expect(markup).toContain('data-slot="accordion"');
    expect(markup).not.toContain("在地圖強調");
    expect(markup.match(/INTERNAL_HALL_DETAIL/g)).toHaveLength(1);
    expect(markup).not.toContain("播放路線動畫");
    expect(markup).not.toContain("暫停路線動畫");
    expect(markup).not.toContain('type="range"');
    expect(markup).not.toContain('aria-current="step"');
    for (const removed of [
      "反向檢視",
      "從頭播放",
      "再次播放",
      "回到鏡頭導覽",
      "並非即時定位或到達判定",
      "手動確認引導",
      "已到教室前走道",
    ])
      expect(markup).not.toContain(removed);
    expect(h.buttons).toHaveLength(1);
    expect(useMapStore.getState().venueJourney?.preview).toMatchObject({
      playing: true,
      following: false,
      direction: 1,
      progress: 0,
    });
    expect(JSON.stringify(useMapStore.getState().venueJourney?.route)).toBe(
      source,
    );
    expect(useMapStore.getState().venueJourney?.route.animationSafe).toBe(
      false,
    );
  });
  it("does not use stale progress to declare completion or expose a playback toggle", () => {
    begin();
    useMapStore
      .getState()
      .setVenueJourneyPreview({ progress: 1, playing: false });
    const markup = renderTour();
    expect(markup).not.toContain("路線導覽結束");
    expect(markup).not.toContain("已抵達");
    expect(markup).not.toContain("播放路線動畫");
    expect(useMapStore.getState().venueJourney?.preview).toMatchObject({
      progress: 1,
      playing: false,
      following: false,
    });
    expect(useMapStore.getState().venueJourney?.guidance.status).toBe(
      "touring",
    );
    expect(useNavStore.getState().arrived).toBe(false);
  });
  it("uses the real English dictionary and preserves source instructions across language changes", () => {
    begin();
    const source = JSON.stringify(useMapStore.getState().venueJourney);
    expect(renderTour()).toContain("校內路線步驟");
    h.language = "en";
    const markup = renderTour();
    expect(markup).toContain("Campus route steps");
    expect(markup).not.toContain("Highlight step");
    expect(markup).toContain("End Navigation");
    expect(markup).toContain("INTERNAL_HALL_DETAIL");
    expect(markup).not.toContain("venueRouteAnimation");
    expect(markup).not.toContain("Play route animation");
    expect(JSON.stringify(useMapStore.getState().venueJourney)).toBe(source);
  });
});
