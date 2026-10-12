import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import en from "@/i18n/locale/en/translation.json";
import zh from "@/i18n/locale/zh-TW/translation.json";
import { a11yPlacesToMarkers } from "../aiResults";
import {
  getAggregatedToolResults,
  getToolResultGroup,
} from "../toolResultCards";

const i18n = createInstance();
beforeAll(async () => {
  await i18n.init({
    lng: "en",
    resources: { en: { translation: en }, "zh-TW": { translation: zh } },
    interpolation: { escapeValue: false },
  });
});
const t = () => i18n.getFixedT("en");
const point = { lat: 25, lng: 121 };

describe("source display names", () => {
  it("prefers facility and parking display values, rejecting whitespace and non-string values", () => {
    const facility = getToolResultGroup(
      "getA11yFacilityDetails",
      {
        facilities: [
          { osmId: 1, name: "電梯", displayName: "Lift", category: "elevator" },
          { osmId: 2, name: "坡道", displayName: "  ", category: "ramp" },
          { osmId: 3, name: "", displayName: "English only", category: "ramp" },
          { osmId: 4, displayName: {}, category: "elevator" },
        ],
      },
      t(),
    );
    expect(facility?.items.map((item) => item.title)).toEqual([
      "Lift",
      "坡道",
      "English only",
      "Elevator",
    ]);
    const parking = getToolResultGroup(
      "findNearbyParking",
      {
        parkingSpots: [
          {
            id: 1,
            ...point,
            placeName: "停車場",
            displayName: "Parking",
            address: "地址",
            displayAddress: "Address",
          },
          {
            id: 2,
            ...point,
            name: "原名",
            displayName: "  ",
            address: "原址",
            displayAddress: " ",
          },
        ],
      },
      t(),
    );
    expect(parking?.items.map((item) => [item.title, item.subtitle])).toEqual([
      ["Parking", "Address"],
      ["原名", "原址"],
    ]);
  });

  it.each(["getBusRoute", "getBusRouteDetail"])(
    "uses normalized backend fields for %s without changing IDs",
    (tool) => {
      const result = {
        routeName: "藍線",
        routeDisplayName: "Blue",
        directions: [
          {
            to: "終點",
            toDisplayName: "Terminal",
            stops: [
              { stopUid: "one", name: "公園", displayName: "Park", ...point },
              { stopUid: "two", name: "原站", displayName: "  ", ...point },
              {
                stopUid: "three",
                name: "",
                displayName: "English only",
                ...point,
              },
            ],
          },
        ],
      };
      const before = structuredClone(result);
      const group = getToolResultGroup(tool, result, t());
      expect(group?.heading).toBe("Bus Blue stops");
      expect(group?.items.map((item) => item.title)).toEqual([
        "Park",
        "原站",
        "English only",
      ]);
      expect(group?.items.map((item) => item.subtitle)).toEqual(
        Array(3).fill("Terminal"),
      );
      expect(group?.items.map((item) => item.id)).toEqual([
        "stop_one",
        "stop_two",
        "stop_three",
      ]);
      expect(result).toEqual(before);
      result.routeDisplayName = " ";
      result.directions[0].toDisplayName = " ";
      expect(getToolResultGroup(tool, result, t())?.heading).toBe(
        "Bus 藍線 stops",
      );
      expect(getToolResultGroup(tool, result, t())?.items[0].subtitle).toBe(
        "終點",
      );
    },
  );

  it("reads top-level positions route display and preserves the plate ID", () => {
    const result = {
      routeName: "藍線",
      routeDisplayName: "Blue",
      buses: [{ plateNumb: "ABC", ...point }],
    };
    expect(
      getToolResultGroup("trackBuses", result, t())?.items[0],
    ).toMatchObject({ id: "bus_ABC", title: "Blue · ABC" });
    result.routeDisplayName = " ";
    expect(getToolResultGroup("trackBuses", result, t())?.items[0].title).toBe(
      "藍線 · ABC",
    );
  });

  it("renders the backend nested timetable trip and headway DTO with source display names", () => {
    const result = {
      routeName: "藍線",
      routeDisplayName: "Blue",
      schedules: [
        {
          subRouteUid: "branch",
          subRouteName: "支線",
          subRouteDisplayName: "Branch",
          direction: 0,
          frequencies: [
            {
              scheduleType: "trip",
              originStopName: "起站",
              originStopDisplayName: "Origin",
              originDepartureTime: "10:00",
            },
            {
              scheduleType: "trip",
              originStopName: "起站",
              originStopDisplayName: " ",
              originDepartureTime: "11:00",
            },
            { scheduleType: "headway", start: "12:00", end: "13:00" },
          ],
        },
      ],
    };
    const group = getToolResultGroup("getBusTimetable", result, t());
    expect(group?.heading).toBe("Bus Blue timetable");
    expect(group?.items.map((item) => [item.title, item.subtitle])).toEqual([
      ["10:00", "Origin"],
      ["11:00", "起站"],
      ["12:00–13:00", "Branch"],
    ]);
    const zhGroup = getToolResultGroup(
      "getBusTimetable",
      result,
      i18n.getFixedT("zh-TW"),
    );
    expect(group?.items.map((item) => item.id)).toEqual(
      zhGroup?.items.map((item) => item.id),
    );
  });

  it("keeps different IDs with identical labels and deduplicates only repeated IDs", () => {
    const groups = getAggregatedToolResults(
      [1, 2, 1].map((osmId) => ({
        name: "getA11yFacilityDetails",
        result: {
          facilities: [
            { osmId, name: "電梯", displayName: "Lift", category: "elevator" },
          ],
        },
      })),
      t(),
    );
    expect(groups[0].items.map((item) => item.id)).toEqual([
      "a11yfac_1",
      "a11yfac_2",
    ]);
  });

  it("does not use bilingual localName for fallback stop IDs", () => {
    const result = {
      directions: [{ stops: [{ StopName: { En: "Park", Zh_tw: "公園" } }] }],
    };
    const enGroup = getToolResultGroup("getBusRoute", result, t());
    const zhGroup = getToolResultGroup(
      "getBusRoute",
      result,
      i18n.getFixedT("zh-TW"),
    );
    expect(enGroup?.items[0].id).toBe("stop_0");
    expect(zhGroup?.items[0].id).toBe("stop_0");
  });

  it("displays marker names/addresses separately from canonical station targets, including English-only bathrooms", () => {
    const result = {
      places: {
        nearbyBathroom: [
          {
            _id: "bath",
            name: "",
            displayName: "Restroom",
            latitude: 25,
            longitude: 121,
            diaper: true,
          },
        ],
        nearbyMetroA11y: [
          {
            _id: "metro",
            "出入口電梯/無障礙坡道名稱": "電梯",
            displayName: "Lift",
            經度: 121,
            緯度: 25,
          },
        ],
        nearbyOsm: [
          {
            osmId: "osm",
            name: "原名",
            displayName: "Facility",
            address: "原址",
            displayAddress: "Address",
            ...point,
          },
        ],
        nearbyParking: [
          {
            id: "parking",
            placeName: "停車",
            displayName: " ",
            address: "地址",
            displayAddress: " ",
            ...point,
          },
        ],
      },
    };
    const before = structuredClone(result);
    const markers = a11yPlacesToMarkers(result, t());
    expect(markers.map((marker) => marker.title)).toEqual([
      "Lift",
      "Restroom",
      "Facility",
      "停車",
    ]);
    expect(markers[2].desc).toBe("Address");
    expect(markers[3].desc).toBe("地址");
    const target = markers[2].target;
    expect(target?.panel).toBe("station");
    if (target?.panel === "station") {
      expect(target.marker.id).toBe("osm");
      expect(target.marker.content).toEqual({ title: "原名", desc: "原址" });
    }
    expect(result).toEqual(before);
  });
});

describe("response language metadata", () => {
  const cases = [
    {
      name: "getA11yFacilityDetails",
      result: { facilities: [{ osmId: 1, name: "電梯", displayName: "Lift" }] },
      english: "Lift",
      canonical: "電梯",
    },
    {
      name: "findNearbyParking",
      result: {
        parkingSpots: [
          {
            id: 1,
            ...point,
            name: "停車場",
            displayName: "Parking",
            address: "地址",
            displayAddress: "Address",
          },
        ],
      },
      english: "Parking",
      canonical: "停車場",
      englishSubtitle: "Address",
      canonicalSubtitle: "地址",
    },
    {
      name: "findA11yPlaces",
      result: {
        places: {
          nearbyOsm: [
            {
              osmId: 1,
              ...point,
              name: "設施",
              displayName: "Facility",
              address: "地址",
              displayAddress: "Address",
            },
          ],
        },
      },
      english: "Facility",
      canonical: "設施",
      englishSubtitle: "Address",
      canonicalSubtitle: "地址",
    },
    ...["getBusRoute", "getBusRouteDetail"].map((name) => ({
      name,
      result: {
        routeName: "藍線",
        routeDisplayName: "Blue",
        directions: [
          {
            to: "終點",
            toDisplayName: "Terminal",
            stops: [
              { stopUid: "one", name: "公園", displayName: "Park", ...point },
            ],
          },
        ],
      },
      english: "Park",
      canonical: "公園",
      englishSubtitle: "Terminal",
      canonicalSubtitle: "終點",
    })),
    {
      name: "trackBuses",
      result: {
        routeName: "藍線",
        routeDisplayName: "Blue",
        buses: [{ plateNumb: "ABC", ...point }],
      },
      english: "Blue · ABC",
      canonical: "藍線 · ABC",
    },
    {
      name: "getBusTimetable",
      result: {
        routeName: "藍線",
        routeDisplayName: "Blue",
        schedules: [
          {
            subRouteUid: "branch",
            direction: 0,
            subRouteName: "支線",
            subRouteDisplayName: "Branch",
            frequencies: [
              {
                originStopName: "起站",
                originStopDisplayName: "Origin",
                originDepartureTime: "10:00",
              },
              { start: "11:00", end: "12:00" },
            ],
          },
        ],
      },
      english: "10:00",
      canonical: "10:00",
      englishSubtitle: "Origin",
      canonicalSubtitle: "起站",
    },
  ];

  it.each(cases)(
    "ignores stale English displays in $name without mutating data, IDs or targets",
    (fixture) => {
      const before = structuredClone(fixture.result);
      const activities = [
        {
          name: fixture.name,
          result: fixture.result,
          displayLanguage: "en" as const,
        },
      ];
      const english = getAggregatedToolResults(activities, t())[0];
      const switched = getAggregatedToolResults(
        activities,
        i18n.getFixedT("zh-TW"),
      )[0];
      expect(english.items[0].title).toBe(fixture.english);
      expect(switched.items[0].title).toBe(fixture.canonical);
      if ("englishSubtitle" in fixture) {
        expect(english.items[0].subtitle).toBe(fixture.englishSubtitle);
        expect(switched.items[0].subtitle).toBe(fixture.canonicalSubtitle);
      }
      expect(switched.items.map((item) => item.id)).toEqual(
        english.items.map((item) => item.id),
      );
      expect(switched.items.map((item) => item.target)).toEqual(
        english.items.map((item) => item.target),
      );
      expect(fixture.result).toEqual(before);
      expect(
        getToolResultGroup(
          fixture.name,
          fixture.result,
          i18n.getFixedT("zh-TW"),
        )?.items[0].title,
      ).toBe(fixture.english);
      expect(
        getToolResultGroup(
          fixture.name,
          fixture.result,
          i18n.getFixedT("zh-TW"),
          "en",
        ),
      ).toEqual(switched);
      if (fixture.name.startsWith("getBus")) {
        expect(switched.heading).toContain("藍線");
        expect(english.heading).toContain("Blue");
      }
      if (fixture.name === "getBusTimetable") {
        expect(english.items[1].subtitle).toBe("Branch");
        expect(switched.items[1].subtitle).toBe("支線");
      }
    },
  );

  it("also ignores stale Chinese displays when rendering English", () => {
    const result = {
      facilities: [{ osmId: 1, name: "canonical", displayName: "顯示" }],
    };
    expect(
      getToolResultGroup("getA11yFacilityDetails", result, t(), "zh-TW")
        ?.items[0].title,
    ).toBe("canonical");
  });
});
