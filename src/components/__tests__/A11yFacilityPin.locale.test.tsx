import type { ReactElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock("zustand/react/shallow", () => ({
  useShallow: (selector: unknown) => selector,
}));
vi.mock("@/hook/usePin", () => ({
  default: () => ({ handlePinClick: vi.fn() }),
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

import A11yFacilityPin from "@/components/A11yFacilityPin";
import useMapStore from "@/stores/useMapStore";
import { A11yEnum, type Marker } from "@/types";

const en: Marker = {
  id: "stable-facility",
  canonicalTitle: "原電梯",
  content: { title: "Lift", desc: "1" },
  position: { lat: 25, lng: 121 },
  type: "pin",
  zIndex: 1,
  a11yType: A11yEnum.ELEVATOR,
};
const zh: Marker = { ...en, content: { title: "原電梯", desc: "1" } };
function nodes(tree: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const element = tree as ReactElement<Record<string, unknown>>;
  return [element, ...nodes(element.props.children)];
}
function clickPin() {
  const button = nodes(A11yFacilityPin({ place: en })).find(
    (element) => element.type === "button",
  );
  if (!button) throw new Error("Expected facility button");
  (button.props.onClick as (event: unknown) => void)({
    stopPropagation: vi.fn(),
  });
}
beforeEach(() =>
  useMapStore.setState({
    selectA11yPlace: null,
    infoShow: { isOpen: false, kind: null },
    searchPlace: null,
  }),
);
it("keeps selected facility and coordinate projections tied to stable ID across locale reloads", () => {
  useMapStore.getState().setA11yPlaces([en]);
  clickPin();
  expect(useMapStore.getState().infoShow).toMatchObject({
    facilityId: en.id,
    address: "Lift (1)",
    canonicalAddress: "原電梯 (1)",
  });
  useMapStore.getState().setA11yPlaces([]);
  expect(useMapStore.getState().selectA11yPlace?.content?.title).toBe("原電梯");
  expect(useMapStore.getState().infoShow).toMatchObject({
    address: "原電梯 (1)",
    position: en.position,
  });
  expect(useMapStore.getState().searchPlace).toMatchObject({
    address: "原電梯 (1)",
    facilityId: en.id,
  });
  useMapStore.getState().setA11yPlaces([zh]);
  expect(useMapStore.getState().selectA11yPlace).toBe(zh);
  useMapStore.getState().setA11yPlaces([en]);
  expect(useMapStore.getState().infoShow).toMatchObject({
    address: "Lift (1)",
  });
  expect(useMapStore.getState().selectA11yPlace?.id).toBe("stable-facility");
});
it("updates the opened facility projection even after selecting the same pin toggled selection off", () => {
  clickPin();
  clickPin();
  expect(useMapStore.getState().selectA11yPlace).toBeNull();
  useMapStore.getState().setA11yPlaces([zh]);
  expect(useMapStore.getState().infoShow).toMatchObject({
    address: "原電梯 (1)",
  });
});
it("does not identify an unrelated place by coincident coordinates or the same translated name", () => {
  clickPin();
  const unrelated = {
    kind: "coordinate" as const,
    address: "Lift (1)",
    position: en.position,
  };
  // Exercise the real merging setter, as ParkingPin/BusStopPin do.
  useMapStore.getState().setInfoShow({ ...unrelated, isOpen: true });
  useMapStore.getState().setSearchPlace(unrelated);
  expect(useMapStore.getState().infoShow).toMatchObject({
    facilityId: undefined,
    canonicalAddress: undefined,
  });
  useMapStore.getState().setA11yPlaces([zh]);
  expect(useMapStore.getState().infoShow).toMatchObject({
    address: "Lift (1)",
  });
  expect(useMapStore.getState().searchPlace).toBe(unrelated);
});
