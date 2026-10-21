import { describe, expect, it } from "vitest";
import { mapToolToActions } from "../ai/toolActionMapper";
import { getToolResultGroup } from "../toolResultCards";

const campus = {
  campusId: 62,
  schoolName: "臺中科技大學",
  branchName: "三民校區",
  location: { type: "Point", coordinates: [120.683, 24.15] },
};
const locationFixtures = [
  [
    "findNearbyBusStops",
    {
      ok: true,
      stops: [
        {
          stopUid: "TXG1",
          stopName: "臺中科技大學",
          coordinates: [120.683, 24.15],
          routes: ["70"],
          distance: 36,
        },
      ],
    },
  ],
  [
    "findCampusAccessibility",
    { ok: true, campuses: [campus], page: 1, totalPages: 3, total: 12 },
  ],
  [
    "getCampusAccessibilityDetails",
    {
      ok: true,
      campus,
      facilities: [],
      truncated: true,
      totalMatchedFacilities: 45,
    },
  ],
  [
    "getNearbyHazards",
    {
      ok: true,
      data: {
        reports: [],
        roadEvents: [
          {
            source: "government",
            hazardType: "construction",
            title: "施工封路",
            description: "人行道施工",
            severity: "warning",
            roadClosed: true,
            endTime: null,
            distanceM: 36,
            location: { lat: 24.15, lng: 120.683 },
          },
        ],
      },
    },
  ],
  [
    "findNearbyParking",
    {
      ok: true,
      parkingSpots: [{ name: "三民停車場", lat: 24.15, lng: 120.683 }],
    },
  ],
  [
    "getA11yFacilityDetails",
    {
      ok: true,
      facilities: [
        {
          osmId: "node/1",
          name: "校門斜坡",
          location: { type: "Point", coordinates: [120.683, 24.15] },
          tags: { wheelchair: "yes" },
        },
      ],
    },
  ],
  [
    "trackBuses",
    { ok: true, buses: [{ plateNumb: "EAA-276", lat: 24.15, lng: 120.683 }] },
  ],
] as const;

describe("voice tool location coverage", () => {
  it.each(locationFixtures)(
    "%s has named cards and station-compatible markers",
    (name, result) => {
      const group = getToolResultGroup(name, result);
      expect(group?.items.length).toBeGreaterThan(0);
      expect(group?.items[0].title).not.toBe("toolResults.item");
      const actions = mapToolToActions(name, result);
      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({
        type: "show-markers",
        markers: [
          {
            position: { lat: 24.15, lng: 120.683 },
            target: { panel: "station" },
          },
        ],
      });
    },
  );
  it.each([
    "findGooglePlaces",
    "findA11yPlaces",
    ...locationFixtures.map(([name]) => name),
  ])("%s preserves markers on empty or failed results", (name) => {
    for (const result of [
      { ok: false, error: "失敗" },
      {},
      { status: "ERROR" },
    ])
      expect(mapToolToActions(name, result)).toEqual([]);
  });
  it.each(locationFixtures)(
    "%s never maps usable-looking failed payloads",
    (name, result) => {
      for (const failure of [
        { ok: false },
        { error: "服務中斷" },
        { status: "LOCATION_REQUIRED" },
        { status: "ERROR" },
      ]) {
        expect(mapToolToActions(name, { ...result, ...failure })).toEqual([]);
      }
    },
  );
  it.each([
    "getBusArrival",
    "getNavInstructions",
    "startNavigation",
    "stopNavigation",
    "proposeNavigationCandidate",
    "confirmNavigationCandidateSwitch",
    "saveMemory",
    "deleteMemory",
  ])("%s does not route or switch through map dispatch", (name) => {
    expect(
      mapToolToActions(name, { ok: true, latitude: 24.15, longitude: 120.683 }),
    ).toEqual([]);
  });
  it("maps every returned vehicle instead of inheriting a presentation limit", () => {
    const actions = mapToolToActions("trackBuses", {
      ok: true,
      buses: Array.from({ length: 35 }, (_, index) => ({
        plateNumb: `車輛-${index}`,
        lat: 24.15 + index / 10000,
        lng: 120.683,
      })),
    });
    expect(actions[0]).toMatchObject({ type: "show-markers" });
    if (actions[0].type !== "show-markers")
      throw new Error("Expected vehicle markers");
    expect(actions[0].markers).toHaveLength(35);
    expect(actions[0].markers.at(-1)?.title).toContain("車輛-34");
  });
  it("does not map invalid coordinates", () => {
    expect(
      mapToolToActions("trackBuses", {
        ok: true,
        buses: [
          { lat: Infinity, lng: 120 },
          { lat: 95, lng: 200 },
        ],
      }),
    ).toEqual([]);
  });
});
