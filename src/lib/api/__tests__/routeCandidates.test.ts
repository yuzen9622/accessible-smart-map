import { afterEach, expect, it, vi } from "vitest";
import { getAccessibleRoute } from "@/lib/api/a11y";
import { departureCandidates } from "@/lib/transit/__tests__/fixtures/departureCandidates";

afterEach(() => vi.unstubAllGlobals());

it("retains backend arrival order, absolute journey times, candidates and geometry provenance", async () => {
  const raw = [
    {
      routeId: "earlier-arrival",
      accessibilityScore: 70,
      totalMinutes: 30,
      departureTime: "2026-10-19T08:00:00+08:00",
      arrivalTime: "2026-10-19T08:30:00+08:00",
      legs: [
        {
          type: "BUS",
          routeName: "82",
          geometrySource: "route_stops",
          departureCandidates,
          candidateSearchComplete: false,
        },
      ],
    },
    {
      routeId: "later-arrival",
      accessibilityScore: 99,
      totalMinutes: 25,
      departureTime: "2026-10-19T08:10:00+08:00",
      arrivalTime: "2026-10-19T08:35:00+08:00",
      legs: [],
    },
  ];
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, code: 200, data: { routes: raw } }),
          { headers: { "Content-Type": "application/json" } },
        ),
    ),
  );
  const res = await getAccessibleRoute({
    language: "zh-TW",
    origin: { latitude: 25, longitude: 121 },
    destination: { latitude: 25.01, longitude: 121.01 },
  });
  expect(res.data?.routes.map((route) => route.routeId)).toEqual([
    "earlier-arrival",
    "later-arrival",
  ]);
  expect(res.data?.routes[0]).toMatchObject({
    departureTime: raw[0].departureTime,
    arrivalTime: raw[0].arrivalTime,
    totalMinutes: 30,
  });
  expect(res.data?.routes[0].legs[0]).toMatchObject({
    geometrySource: "route_stops",
    departureCandidates,
    candidateSearchComplete: false,
  });
});
