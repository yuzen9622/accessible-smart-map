import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

for (const store of [
  "@/stores/useMapStore",
  "@/stores/useIndoorCatalog",
  "@/stores/useNavStore",
])
  vi.doMock(store, async () => {
    const actual = await vi.importActual<{
      default: { getState: () => unknown };
    }>(store);
    return {
      ...actual,
      default: Object.assign(
        (select: (state: unknown) => unknown) =>
          select(actual.default.getState()),
        actual.default,
      ),
    };
  });
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: <T,>(initial: T) => [initial, () => {}],
}));
vi.mock("@/i18n/client", () => ({
  useAppTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${Object.values(values).join(",")}` : key,
  }),
}));

const { crossCampusJourney, campusModel } = await import(
  "@/lib/indoor/__tests__/fixtures/crossCampusJourney"
);
const { default: useIndoorCatalog } = await import("@/stores/useIndoorCatalog");
const { default: useMapStore } = await import("@/stores/useMapStore");
const { default: VenueTourHUD } = await import("../VenueTourHUD");

type Props = {
  children?: ReactNode;
  onClick?: () => void;
  "aria-current"?: string;
  "aria-label"?: string;
};

function elements(node: ReactNode): ReactElement<Props>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<Props>(child)) return [];
    const rendered =
      typeof child.type === "function"
        ? (child.type as (props: Props) => ReactNode)(child.props)
        : null;
    return [
      child,
      ...elements(rendered ?? null),
      ...elements(child.props.children),
    ];
  });
}

function chips() {
  const nav = elements(VenueTourHUD()).find(
    (element) => element.props["aria-label"] === "venueRouteFloors",
  );
  return elements(nav?.props.children).filter(
    (element) => element.type === "button",
  );
}

const east = campusModel("east", ["1F", "2F", "3F"]);
const west = campusModel("west", ["1F", "2F"]);

beforeEach(() => {
  useIndoorCatalog.setState({
    models: [east, west],
    activeBuildingKey: "campus/east",
    activeLevel: 2,
  });
  useMapStore.setState({
    venueJourney: crossCampusJourney(),
    indoorExploring: true,
  });
});

describe("indoor route tour HUD", () => {
  it("shows one chip per floor of the route and marks the floor on the map", () => {
    const markup = renderToStaticMarkup(<VenueTourHUD />);
    expect(markup).toContain("East Hall · 3F");
    expect(markup).toContain("routeOutdoorSection");
    expect(markup).toContain("West Hall · 1F");
    expect(markup).toContain("venueArriveAt:west-101");
    const labels = chips().map((chip) =>
      Children.toArray(chip.props.children).join(""),
    );
    expect(labels).toEqual([
      "East Hall · 3F",
      "1F",
      "routeOutdoorSection",
      "West Hall · 1F",
    ]);
    expect(chips()[0].props["aria-current"]).toBe("step");
  });

  it("switches the map to the building and floor of a chosen section", () => {
    chips()[3].props.onClick?.();
    expect(useIndoorCatalog.getState()).toMatchObject({
      activeBuildingKey: "campus/west",
      activeLevel: 0,
    });
    chips()[0].props.onClick?.();
    expect(useIndoorCatalog.getState()).toMatchObject({
      activeBuildingKey: "campus/east",
      activeLevel: 2,
    });
  });

  it("renders nothing outside the route tour", () => {
    const journey = crossCampusJourney();
    journey.guidance.status = "idle";
    useMapStore.setState({ venueJourney: journey });
    expect(renderToStaticMarkup(<VenueTourHUD />)).toBe("");
  });
});
