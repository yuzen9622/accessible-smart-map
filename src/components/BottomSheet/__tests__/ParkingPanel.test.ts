import { describe, expect, it } from "vitest";
import {
  carParkTypeLabel,
  chargeTypesLabels,
  parkingItemLngLat,
} from "@/components/BottomSheet/ParkingPanel";
import type { ParkingNearbyItem } from "@/types/route";

const t = (key: string) => `T:${key}`;

describe("carParkTypeLabel", () => {
  it("maps TDX car park type codes to labels", () => {
    expect(carParkTypeLabel(t, 1)).toBe("T:parkingTypeSurface");
    expect(carParkTypeLabel(t, 2)).toBe("T:parkingTypeMultiStory");
    expect(carParkTypeLabel(t, 3)).toBe("T:parkingTypeUnderground");
    expect(carParkTypeLabel(t, 4)).toBe("T:parkingTypeTower");
    expect(carParkTypeLabel(t, 5)).toBe("T:parkingTypeMechanical");
  });

  it("returns null for unknown/absent types", () => {
    expect(carParkTypeLabel(t, 6)).toBeNull();
    expect(carParkTypeLabel(t, undefined)).toBeNull();
  });
});

describe("chargeTypesLabels", () => {
  it("maps TDX charge codes to labels", () => {
    expect(chargeTypesLabels(t, [1, 2, 3, 4])).toEqual([
      { code: 1, label: "T:chargeTypeHourly" },
      { code: 2, label: "T:chargeTypePerEntry" },
      { code: 3, label: "T:chargeTypeMonthly" },
      { code: 4, label: "T:chargeTypeFree" },
    ]);
  });

  it("skips unknown codes (e.g. TDX 255 sentinel) instead of showing noise", () => {
    expect(chargeTypesLabels(t, [255])).toEqual([]);
    expect(chargeTypesLabels(t, [1, 99])).toEqual([
      { code: 1, label: "T:chargeTypeHourly" },
    ]);
  });

  it("returns [] for absent charge info", () => {
    expect(chargeTypesLabels(t, undefined)).toEqual([]);
    expect(chargeTypesLabels(t, [])).toEqual([]);
  });
});

// Fixtures copied from a live GET /a11y/parking/nearby response: both shapes
// carry coordinates only in `location` — there is no `position`/`latitude`.
describe("parkingItemLngLat", () => {
  const lot: ParkingNearbyItem = {
    type: "lot",
    _id: "6a7f03cfe221e3d2e94636fd",
    carParkId: "TPE1015",
    name: "呷呷房西門中華1站停車場",
    address: "臺北市中正區延平南路110號地下2至3層",
    city: "臺北市",
    carParkType: 3,
    chargeTypes: [4],
    wheelchairAccessible: true,
    disabledSpaces: 1,
    totalCarSpaces: 43,
    location: { type: "Point", coordinates: [121.5093, 25.04274] },
    importedAt: "2026-08-14T12:02:20.234Z",
  };

  const space: ParkingNearbyItem = {
    type: "disabled",
    _id: "sp-1",
    city: "新北市",
    district: "八里區",
    quantity: 1,
    placeName: "商港八路",
    isMarked: true,
    location: {
      type: "Point",
      coordinates: [121.4102, 25.15043],
    },
    importedAt: "2026-08-14T12:02:20.235Z",
  };

  it("reads GeoJSON location.coordinates for lots (lng, lat order)", () => {
    expect(parkingItemLngLat(lot)).toEqual({ lng: 121.5093, lat: 25.04274 });
  });

  it("reads GeoJSON location.coordinates for space items", () => {
    expect(parkingItemLngLat(space)).toEqual({ lng: 121.4102, lat: 25.15043 });
  });

  it("returns null for non-finite coordinates", () => {
    const bad = {
      ...lot,
      location: {
        type: "Point" as const,
        coordinates: [Number.NaN, 24.13365] as [number, number],
      },
    };
    expect(parkingItemLngLat(bad)).toBeNull();
  });

  it("returns null instead of throwing when location is absent", () => {
    const noLocation = {
      ...lot,
      location: undefined,
    } as unknown as ParkingNearbyItem;
    expect(parkingItemLngLat(noLocation)).toBeNull();
  });
});
