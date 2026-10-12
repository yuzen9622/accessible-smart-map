import i18next from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import en from "@/i18n/locale/en/translation.json";
import zhTW from "@/i18n/locale/zh-TW/translation.json";

beforeAll(async () => {
  await i18next.init({
    lng: "zh-TW",
    fallbackLng: "zh-TW",
    resources: { en: { translation: en }, "zh-TW": { translation: zhTW } },
    interpolation: { escapeValue: false },
  });
});

import {
  getAggregatedToolResults,
  getToolResultGroup,
} from "../toolResultCards";

describe("toolResultCards", () => {
  describe("getToolResultGroup", () => {
    it("should parse trackBuses results correctly", () => {
      const result = {
        ok: true,
        buses: [
          {
            plateNumb: "028-U3",
            routeName: "284",
            directionLabel: "往大安森林公園",
            stopsAway: 2,
            isLowFloor: "1",
            lat: 25.03,
            lng: 121.53,
          },
        ],
        count: 1,
        lowFloorCount: 1,
      };

      const group = getToolResultGroup("trackBuses", result);
      expect(group).not.toBeNull();
      expect(group?.heading).toBe("公車即時動態");
      expect(group?.icon).toBe("bus");
      expect(group?.items).toHaveLength(1);
      expect(group?.items[0].title).toBe("284 · 028-U3");
      expect(group?.items[0].badge).toBe("低地板");
    });
  });

  describe("getAggregatedToolResults", () => {
    it("should return empty array for empty activities", () => {
      expect(getAggregatedToolResults([])).toEqual([]);
      expect(getAggregatedToolResults(undefined)).toEqual([]);
    });

    it("should ignore running activities", () => {
      const activities = [
        {
          name: "trackBuses",
          status: "running",
          result: {
            ok: true,
            buses: [{ plateNumb: "028-U3", lat: 25.03, lng: 121.53 }],
          },
        },
      ];
      expect(getAggregatedToolResults(activities)).toEqual([]);
    });

    it("should aggregate and deduplicate multiple trackBuses activities into a single group", () => {
      const activities = [
        {
          name: "trackBuses",
          status: "done",
          result: {
            ok: true,
            buses: [
              {
                plateNumb: "028-U3",
                routeName: "284",
                lat: 25.03,
                lng: 121.53,
              },
              {
                plateNumb: "079-U3",
                routeName: "284",
                lat: 25.04,
                lng: 121.54,
              },
            ],
            count: 2,
          },
        },
        {
          name: "trackBuses",
          status: "done",
          result: {
            ok: true,
            buses: [
              // 重複的車牌 028-U3
              {
                plateNumb: "028-U3",
                routeName: "284",
                lat: 25.03,
                lng: 121.53,
              },
              // 新車牌
              {
                plateNumb: "167-U3",
                routeName: "信義幹線",
                lat: 25.05,
                lng: 121.55,
              },
            ],
            count: 2,
          },
        },
      ];

      const groups = getAggregatedToolResults(activities);
      expect(groups).toHaveLength(1);
      expect(groups[0].heading).toBe("公車即時動態");
      // 總共應該有 3 筆不重複的公車
      expect(groups[0].items).toHaveLength(3);
      expect(groups[0].items.map((i) => i.title)).toEqual([
        "284 · 028-U3",
        "284 · 079-U3",
        "信義幹線 · 167-U3",
      ]);
    });

    it("should separate different tool types into distinct groups", () => {
      const activities = [
        {
          name: "trackBuses",
          status: "done",
          result: {
            ok: true,
            buses: [
              {
                plateNumb: "028-U3",
                routeName: "284",
                lat: 25.03,
                lng: 121.53,
              },
            ],
          },
        },
        {
          name: "findGooglePlaces",
          status: "done",
          result: {
            places: [
              {
                id: "place_1",
                displayName: { text: "大安森林公園" },
                location: { latitude: 25.03, longitude: 121.53 },
              },
            ],
          },
        },
      ];

      const groups = getAggregatedToolResults(activities);
      expect(groups).toHaveLength(2);
      expect(groups[0].heading).toBe("公車即時動態");
      expect(groups[1].heading).toBe("周邊地點");
    });
  });
});

describe.each(["en", "zh-TW"])("tool result translations: %s", (language) => {
  const translate = () => i18next.getFixedT(language);
  const english = language === "en";

  it("localizes bus headings, counts and badges without translating backend prose", () => {
    const group = getToolResultGroup(
      "trackBuses",
      {
        buses: [
          {
            routeName: "信義幹線",
            plateNumb: "ABC",
            directionLabel: "往市政府",
            stopsAway: 2,
            isLowFloor: true,
            lat: 25,
            lng: 121,
          },
        ],
        count: 1,
        lowFloorCount: 1,
      },
      translate(),
    );
    expect(group?.heading).toBe(
      english ? "Live bus locations" : "公車即時動態",
    );
    expect(group?.items[0].title).toBe("信義幹線 · ABC");
    expect(group?.items[0].subtitle).toBe(
      english ? "往市政府 · 2 stops away" : "往市政府 · 還有 2 站",
    );
    expect(group?.items[0].badge).toBe(english ? "Low-floor" : "低地板");
    expect(group?.note).toBe(
      english ? "1 bus，1 low-floor bus" : "共 1 班，低地板 1 班",
    );
  });

  it("localizes all ETA states and prefers the bilingual name for the selected language", () => {
    const group = getToolResultGroup(
      "getBusRoute",
      {
        routeName: { En: "Blue 1", Zh_tw: "藍1" },
        directions: [
          {
            destination: { En: "City Hall", Zh_tw: "市政府" },
            stops: [0, 30, 120].map((EstimateTime, i) => ({
              StopUID: String(i),
              StopName: { En: "Park", Zh_tw: "公園" },
              EstimateTime,
            })),
          },
        ],
      },
      translate(),
    );
    expect(group?.heading).toBe(english ? "Bus Blue 1 stops" : "公車 藍1 站牌");
    expect(group?.items.map((item) => item.title)).toEqual(
      Array(3).fill(english ? "Park" : "公園"),
    );
    expect(group?.items.map((item) => item.subtitle)).toEqual(
      english
        ? [
            "City Hall · Arriving",
            "City Hall · Arriving soon",
            "City Hall · About 2 min",
          ]
        : ["市政府 · 進站中", "市政府 · 即將進站", "市政府 · 約 2 分"],
    );
  });

  it("keeps Zh_tw when English is missing and keeps string names and ETA prose", () => {
    const group = getToolResultGroup(
      "getBusRouteDetail",
      {
        routeName: { Zh_tw: "中文路線" },
        directions: [
          {
            destination: "中文目的地",
            stops: [
              { StopName: { Zh_tw: "中文站名" }, EstimateTime: "末班車已離站" },
              { StopName: "中文地名" },
            ],
          },
        ],
      },
      translate(),
    );
    expect(group?.items[0].title).toBe("中文站名");
    expect(group?.items[0].subtitle).toBe("中文目的地 · 末班車已離站");
    expect(group?.items[1].title).toBe("中文地名");
    expect(group?.heading).toBe(
      english ? "Bus 中文路線 stops" : "公車 中文路線 站牌",
    );
  });

  it("localizes known categories and wheelchair labels but preserves names and unknown enums", () => {
    const group = getToolResultGroup(
      "getA11yFacilityDetails",
      {
        facilities: [
          { category: "elevator", wheelchair: "yes" },
          { name: "電梯", category: "ramp", wheelchair: "limited" },
          { category: "backend_custom" },
        ],
      },
      translate(),
    );
    expect(group?.heading).toBe(
      english ? "Accessible facility details" : "無障礙設施詳情",
    );
    expect(group?.items[0].title).toBe(english ? "Elevator" : "電梯");
    expect(group?.items[0].subtitle).toBe(
      english ? "Elevator · Wheelchair accessible" : "電梯 · 輪椅可通行",
    );
    expect(group?.items[1].title).toBe("電梯");
    expect(group?.items[1].subtitle).toBe(
      english
        ? "Accessible ramp · Partially accessible"
        : "無障礙坡道 · 部分無障礙",
    );
    expect(group?.items[2].title).toBe("backend_custom");
  });

  it("localizes marker fallbacks only, including bathroom-generated labels", () => {
    const places = getToolResultGroup(
      "findGooglePlaces",
      {
        places: [
          { lat: 25, lng: 121 },
          { name: "地點", lat: 26, lng: 121 },
        ],
      },
      translate(),
    );
    expect(places?.heading).toBe(english ? "Nearby places" : "周邊地點");
    expect(places?.items.map((item) => item.title)).toEqual([
      english ? "Place" : "地點",
      "地點",
    ]);
    const facilities = getToolResultGroup(
      "findA11yPlaces",
      {
        places: {
          nearbyOsm: [
            { id: 1, lat: 25, lng: 121 },
            { id: 2, name: "無障礙設施", lat: 26, lng: 121 },
          ],
          nearbyBathroom: [
            {
              _id: "bath",
              name: "中文廁所",
              latitude: 25,
              longitude: 121,
              diaper: true,
            },
          ],
        },
      },
      translate(),
    );
    expect(facilities?.items.map((item) => item.title)).toEqual([
      "中文廁所",
      english ? "Accessible facilities" : "無障礙設施",
      "無障礙設施",
    ]);
    expect(facilities?.items[0].subtitle).toBe(
      english ? "Changing table available" : "有提供尿布台",
    );
  });

  it("localizes parking, hazards, environment and navigation while preserving backend descriptions", () => {
    const parking = getToolResultGroup(
      "findNearbyParking",
      { parkingSpots: [{ lat: 25, lng: 121, quantity: 2 }], total: 3 },
      translate(),
    );
    expect(parking?.items[0].badge).toBe(english ? "2 spaces" : "2 位");
    expect(parking?.note).toBe(english ? "3 nearby locations" : "附近共 3 處");
    const hazards = getToolResultGroup(
      "getNearbyHazards",
      {
        reports: [
          { lat: 25, lng: 121, hazardType: "construction", status: "verified" },
          { lat: 26, lng: 121, description: "施工說明" },
        ],
      },
      translate(),
    );
    expect(hazards?.items[0].title).toBe(english ? "Construction" : "施工");
    expect(hazards?.items[0].subtitle).toBe(english ? "Verified" : "已確認");
    expect(hazards?.items[1].subtitle).toBe("施工說明");
    const environment = getToolResultGroup(
      "getEnvironmentInfo",
      {
        weather: { condition: "多雲", precipitationProbability: 30 },
        cameras: { items: [{}] },
      },
      translate(),
    );
    expect(environment?.heading).toBe(
      english ? "Nearby environment" : "周邊環境資訊",
    );
    expect(environment?.items[0].title).toBe("多雲");
    expect(environment?.items[0].subtitle).toBe(
      english ? "Chance of rain 30%" : "降雨機率 30%",
    );
    expect(environment?.items[1].title).toBe(
      english ? "Live camera" : "即時影像",
    );
    const nav = getToolResultGroup(
      "getNavInstructions",
      {
        instructions: [{ streetName: "中文路名" }, { text: "後端指引" }],
        totalSteps: 2,
      },
      translate(),
    );
    expect(nav?.items[0].title).toBe(english ? "Step 1" : "第 1 步");
    expect(nav?.items[0].subtitle).toBe("中文路名");
    expect(nav?.items[1].title).toBe("後端指引");
    expect(nav?.note).toBe(english ? "2 steps" : "共 2 步");
  });

  it("aggregates and deduplicates using the supplied translator", () => {
    const activities = [0, 1].map(() => ({
      name: "getBusRoute",
      result: {
        directions: [{ stops: [{ StopUID: "same", EstimateTime: 120 }] }],
      },
    }));
    const groups = getAggregatedToolResults(activities, translate());
    expect(groups).toHaveLength(1);
    expect(groups[0].heading).toBe(english ? "Bus stops" : "公車站牌");
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0].title).toBe(english ? "Bus stop" : "站牌");
    expect(groups[0].items[0].subtitle).toBe(
      english ? "About 2 min" : "約 2 分",
    );
  });
});

it("recomputes the same activities in another language without changing backend data", () => {
  const activities = [
    {
      name: "getBusRoute",
      result: {
        routeName: { En: "Blue", Zh_tw: "藍線" },
        directions: [
          {
            stops: [
              {
                StopUID: "id",
                StopName: { En: "Park", Zh_tw: "公園" },
                EstimateTime: 60,
              },
            ],
          },
        ],
      },
    },
  ];
  const zh = getAggregatedToolResults(activities, i18next.getFixedT("zh-TW"));
  const en = getAggregatedToolResults(activities, i18next.getFixedT("en"));
  expect(zh[0].heading).toBe("公車 藍線 站牌");
  expect(en[0].heading).toBe("Bus Blue stops");
  expect(zh[0].items[0].id).toBe(en[0].items[0].id);
  expect(activities[0].result.routeName.Zh_tw).toBe("藍線");
});

describe.each(["en", "zh-TW"])("timetable and air quality: %s", (language) => {
  it("localizes timetable headings and fallback departures, not backend time or note", () => {
    const t = i18next.getFixedT(language);
    const group = getToolResultGroup(
      "getBusTimetable",
      {
        routeName: { En: "Blue", Zh_tw: "藍線" },
        schedules: [
          {},
          { note: "後端備註" },
          { time: "班次" },
          { time: "10:00", destination: { En: "Park", Zh_tw: "公園" } },
        ],
      },
      t,
    );
    expect(group?.heading).toBe(
      language === "en" ? "Bus Blue timetable" : "公車 藍線 時刻表",
    );
    expect(group?.items).toHaveLength(3);
    expect(group?.items[0].title).toBe(
      language === "en" ? "Departure" : "班次",
    );
    expect(group?.items[0].subtitle).toBe("後端備註");
    expect(group?.items[1].title).toBe("班次");
    expect(group?.items[2].title).toBe("10:00");
    expect(group?.items[2].subtitle).toBe(language === "en" ? "Park" : "公園");
  });

  it("localizes air quality headings without translating area, quality or advice", () => {
    const group = getToolResultGroup(
      "getAirQuality",
      { city: "臺北", area: "大安", quality: "良好", advice: "後端建議" },
      i18next.getFixedT(language),
    );
    expect(group?.heading).toBe(
      language === "en" ? "Air quality · 臺北 大安" : "空氣品質 · 臺北 大安",
    );
    expect(group?.items[0].title).toBe("良好");
    expect(group?.note).toBe("後端建議");
  });
});
