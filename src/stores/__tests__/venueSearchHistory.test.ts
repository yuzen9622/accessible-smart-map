import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useMapStore from "@/stores/useMapStore";
import type { VenuePlaceDetail } from "@/types";

const room = (overrides: Partial<VenuePlaceDetail> = {}): VenuePlaceDetail => ({
  kind: "venue-place",
  name: "101 教室",
  address: "同名教室",
  venueId: "test-campus",
  buildingId: "building-a",
  buildingName: "A 館",
  levelRef: "L1",
  placeId: "room-101",
  sourceVersion: "source-v1",
  dataSource: "local",
  arrivalKind: "corridor",
  position: { lat: 24, lng: 120 },
  ...overrides,
});

describe("venue search history and saved identity", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { setItem: vi.fn(), removeItem: vi.fn() });
    useMapStore.setState({
      searchHistory: [],
      savedPlaces: [],
      savedPlaceKeys: new Set(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("retains same-name, same-coordinate rooms on different floors and buildings", () => {
    const places = [
      room(),
      room({ levelRef: "L2" }),
      room({ buildingId: "building-b" }),
      room({ venueId: "other-campus" }),
    ];
    for (const place of places) useMapStore.getState().addSearchHistory(place);
    expect(useMapStore.getState().searchHistory).toHaveLength(4);
    expect(useMapStore.getState().searchHistory).toEqual([...places].reverse());
  });

  it("refreshes the same endpoint's label and revision without duplicating it", () => {
    useMapStore.getState().addSearchHistory(room());
    const latest = room({
      name: "Room 101",
      address: "Building A · L1 · Room 101",
      sourceVersion: "source-v2",
    });
    useMapStore.getState().addSearchHistory(latest);
    expect(useMapStore.getState().searchHistory).toEqual([latest]);
  });

  it("hydrates histories by identity and preserves distinct outdoor endpoints", () => {
    const entrance = room({
      buildingId: null,
      levelRef: null,
      placeId: "gate-one",
    });
    const secondEntrance = { ...entrance, placeId: "gate-two" };
    useMapStore
      .getState()
      .initSearchHistory([entrance, room(), room(), secondEntrance]);
    expect(useMapStore.getState().searchHistory).toEqual([
      entrance,
      room(),
      secondEntrance,
    ]);
  });

  it("keeps saved state independent for overlapping floors and removes only the requested room", () => {
    const first = room();
    const second = room({ levelRef: "L2" });
    useMapStore.getState().initSavedPlaces([first, first, second]);
    expect(useMapStore.getState().savedPlaces).toHaveLength(2);
    expect(useMapStore.getState().isSavedPlace(second)).toBe(true);
    useMapStore.getState().removeSavedPlace(first);
    expect(useMapStore.getState().savedPlaces).toEqual([second]);
    expect(useMapStore.getState().isSavedPlace(first)).toBe(false);
  });
});
