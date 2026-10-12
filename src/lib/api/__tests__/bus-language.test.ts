import { afterEach, expect, it, vi } from "vitest";
import {
  parseBusArrivals,
  parseBusRouteDirections,
  parseBusTimetable,
  parseLiveBusPositions,
} from "../busParsers";
import {
  getBusArrival,
  getBusRouteDetail,
  getBusTimetable,
  getLiveBusPositions,
  getNearbyBusStops,
  searchBusRoutes,
  searchBusStops,
} from "../transit";

afterEach(() => vi.unstubAllGlobals());
it("adds lang to transit name GETs but preserves the strict token-scoped planned-arrivals query", async () => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            routeName: "中文",
            city: "Taipei",
            stops: [],
            routes: [],
            arrivals: [],
            buses: [],
            directions: [],
            schedules: [],
            note: "",
          },
        }),
      ),
  );
  vi.stubGlobal("fetch", fetch);
  await searchBusRoutes("中文", undefined, "en");
  await searchBusStops("中文", undefined, "en");
  await getNearbyBusStops(25, 121, "en");
  await getBusArrival("中文", "站", 0, "Taipei", undefined, "en");
  await getLiveBusPositions("中文", "Taipei", 0, undefined, "en");
  await getBusTimetable("中文", "Taipei", undefined, "en");
  await getBusRouteDetail("中文", "Taipei", "id", undefined, undefined, "en");
  await getBusRouteDetail(
    "中文",
    "Taipei",
    "id",
    undefined,
    { routeToken: "token", legIndex: 2 },
    "en",
  );
  for (const call of (fetch.mock.calls as unknown as [string][]).slice(0, -1))
    expect(new URL(call[0]).searchParams.get("lang")).toBe("en");
  const plan = new URL((fetch.mock.calls as unknown as [string][]).at(-1)![0]);
  expect(Object.fromEntries(plan.searchParams)).toEqual({
    routeToken: "token",
    legIndex: "2",
  });
  await searchBusRoutes("中文");
  expect(
    new URL(
      (fetch.mock.calls as unknown as [string][]).at(-1)![0],
    ).searchParams.has("lang"),
  ).toBe(false);
});
it("narrow parsers retain correct display fields and canonical identities", () => {
  const branch = {
    subRouteUid: "id",
    subRouteName: "支線",
    subRouteDisplayName: "Branch",
  };
  expect(
    parseBusArrivals({
      arrivals: [
        {
          ...branch,
          stopName: "站",
          stopDisplayName: "Stop",
          direction: 0,
          estimateMinutes: 1,
        },
      ],
    })[0],
  ).toMatchObject({ ...branch, stopName: "站", stopDisplayName: "Stop" });
  const stops = [
    {
      seq: 1,
      name: "站",
      displayName: "Stop",
      lat: 25,
      lng: 121,
      estimateMinutes: null,
    },
  ];
  const parsed = parseBusRouteDirections({
    directions: [
      {
        ...branch,
        direction: 0,
        from: "起點",
        to: "終點",
        fromDisplayName: "Origin",
        toDisplayName: "End",
        stops,
      },
    ],
  });
  expect(parsed[0]).toMatchObject({
    ...branch,
    fromDisplayName: "Origin",
    toDisplayName: "End",
    stops: [{ name: "站", displayName: "Stop" }],
  });
  expect(
    parseBusRouteDirections({
      directions: [
        {
          direction: 0,
          stops: [{ ...stops[0], name: "", displayName: "English only" }],
        },
      ],
    })[0].stops[0].name,
  ).toBe("");
  const live = parseLiveBusPositions({
    routeName: "線",
    routeDisplayName: "Line",
    city: "Taipei",
    buses: [{ ...branch, plateNumb: "ABC", direction: 0, lat: 25, lng: 121 }],
  });
  expect(live).toMatchObject({
    routeName: "線",
    routeDisplayName: "Line",
    buses: [branch],
  });
  const trip = {
    scheduleType: "trip",
    serviceDays: "daily",
    originStopName: "站",
    originStopDisplayName: "Stop",
    originDepartureTime: "06:00",
    stopTimes: [
      { seq: 1, stopName: "站", stopDisplayName: "Stop", arrivalTime: "06:00" },
    ],
  };
  expect(
    parseBusTimetable({
      routeName: "線",
      routeDisplayName: "Line",
      city: "Taipei",
      note: "",
      schedules: [{ ...branch, direction: 0, frequencies: [trip] }],
    }),
  ).toMatchObject({
    routeDisplayName: "Line",
    schedules: [{ ...branch, frequencies: [trip] }],
  });
  expect(
    parseBusArrivals({
      arrivals: [
        {
          direction: 0,
          stopName: "站",
          stopDisplayName: "  ",
          subRouteDisplayName: 2,
          estimateMinutes: null,
        },
      ],
    })[0],
  ).not.toHaveProperty("stopDisplayName");
});

it("keeps English-only metadata and timetable stops without replacing empty canonical fields", () => {
  expect(
    parseLiveBusPositions({
      routeName: "",
      routeDisplayName: "Line",
      city: "Taipei",
      buses: [],
    }),
  ).toMatchObject({ routeName: "", routeDisplayName: "Line" });
  const trip = {
    scheduleType: "trip",
    serviceDays: "daily",
    originStopName: "",
    originStopDisplayName: "Origin",
    originDepartureTime: "06:00",
    stopTimes: [
      { seq: 1, stopName: "", stopDisplayName: "Origin", arrivalTime: "06:00" },
    ],
  };
  expect(
    parseBusTimetable({
      routeName: "",
      routeDisplayName: "Line",
      city: "Taipei",
      note: "",
      schedules: [{ direction: 0, frequencies: [trip] }],
    }).schedules[0].frequencies,
  ).toEqual([trip]);
});
