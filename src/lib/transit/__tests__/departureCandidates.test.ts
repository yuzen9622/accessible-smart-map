import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseBusCandidateMetadata } from "@/lib/api/busParsers";
import {
  __clearRouteDetailCache,
  fetchRouteDetailSnapshot,
  routeDetailKey,
  subscribeRouteDetail,
} from "@/lib/transit/busRouteDetailCache";
import {
  busRouteNames,
  formatRouteClock,
  formatRouteInstant,
  resolveViewedCandidate,
  routeDayOffset,
} from "@/lib/transit/departureCandidates";
import type { BusLeg } from "@/types/route";
import { departureCandidates as candidates } from "./fixtures/departureCandidates";

const { getBusRouteDetail } = vi.hoisted(() => ({
  getBusRouteDetail: vi.fn(),
}));
vi.mock("@/lib/api/transit", () => ({ getBusRouteDetail }));

beforeEach(() => {
  __clearRouteDetailCache();
  getBusRouteDetail.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("public departure candidate metadata", () => {
  it("preserves false, null, unknown, order and the selected non-first candidate", () => {
    expect(
      parseBusCandidateMetadata({
        departureCandidates: candidates,
        candidateSearchComplete: false,
      }),
    ).toEqual({
      departureCandidates: candidates,
      candidateSearchComplete: false,
    });
  });
  it("keeps legacy absence distinct from a known empty result", () => {
    expect(parseBusCandidateMetadata({ directions: [] })).toEqual({});
    expect(
      parseBusCandidateMetadata({
        departureCandidates: [],
        candidateSearchComplete: false,
      }),
    ).toEqual({ departureCandidates: [], candidateSearchComplete: false });
  });
  it.each([
    { ...candidates[0], direction: 255 },
    { ...candidates[0], estimatedWaitMinutes: -1 },
    { ...candidates[0], vehicleAccessibility: false },
    { ...candidates[0], boardingTime: null },
    { ...candidates[2], selected: true },
    { ...candidates[0], boardingTime: "23:58" },
  ])("rejects malformed or untrustworthy candidate data", (candidate) => {
    expect(() =>
      parseBusCandidateMetadata({ departureCandidates: [candidate] }),
    ).toThrow();
  });
  it("rejects a non-boolean completeness flag and unbounded lists", () => {
    expect(() =>
      parseBusCandidateMetadata({ candidateSearchComplete: "false" }),
    ).toThrow();
    expect(() =>
      parseBusCandidateMetadata({
        departureCandidates: Array(6).fill(candidates[0]),
      }),
    ).toThrow();
  });
});

describe("display-only candidate identity", () => {
  it("chooses selected:true, never the earliest boarding by index", () => {
    expect(resolveViewedCandidate(candidates)?.candidateId).toBe("chosen-82");
    expect(resolveViewedCandidate(candidates, "early-12")?.candidateId).toBe(
      "early-12",
    );
  });
  it("retains an explicit viewed id through refresh, falls back only if it disappeared", () => {
    const refreshed = candidates.map((c) => ({
      ...c,
      selected: c.candidateId === "early-12",
    }));
    expect(resolveViewedCandidate(refreshed, "chosen-82")?.candidateId).toBe(
      "chosen-82",
    );
    expect(resolveViewedCandidate(refreshed, "removed")?.candidateId).toBe(
      "early-12",
    );
    expect(
      resolveViewedCandidate(
        candidates.map((c) => ({ ...c, selected: false })),
      ),
    ).toBeNull();
    expect(resolveViewedCandidate([])).toBeNull();
  });
  it("shows each line once without sorting candidates or mutating the planned leg", () => {
    const leg = { routeName: "82", departureCandidates: candidates } as BusLeg;
    const before = JSON.stringify(leg);
    expect(busRouteNames(leg)).toEqual(["12", "82"]);
    expect(busRouteNames({ routeName: "legacy" } as BusLeg)).toEqual([
      "legacy",
    ]);
    expect(JSON.stringify(leg)).toBe(before);
  });
  it("formats absolute times in Taiwan including the date across midnight", () => {
    expect(formatRouteInstant("2026-10-19T15:58:00Z", "zh-TW")).toContain(
      "23:58",
    );
    expect(formatRouteInstant(candidates[0].boardingTime, "zh-TW")).toContain(
      "10/19",
    );
    expect(formatRouteInstant(candidates[0].alightingTime, "zh-TW")).toContain(
      "10/20",
    );
    expect(formatRouteInstant("08:00", "zh-TW")).toBeNull();
    expect(formatRouteInstant(null, "zh-TW")).toBeNull();
  });
});

describe("compact visible time formatting", () => {
  it("renders padded Taiwan HH:mm, never a full date or AM/PM", () => {
    expect(formatRouteClock("2026-10-19T00:39:00Z", "zh-TW")).toBe("08:39");
    expect(formatRouteClock("2026-10-19T00:39:00Z", "en")).toBe("08:39");
    expect(formatRouteClock(null, "zh-TW")).toBeNull();
    expect(formatRouteClock("08:39", "zh-TW")).toBeNull();
  });
  it("marks midnight and year boundaries using Taiwan calendar days", () => {
    expect(routeDayOffset("2026-10-19T16:01:00Z", "2026-10-19T15:59:00Z")).toBe(
      1,
    );
    expect(routeDayOffset("2026-10-19T01:00:00Z", "2026-10-19T00:39:00Z")).toBe(
      0,
    );
    expect(
      routeDayOffset("2027-01-01T00:01:00+08:00", "2026-12-31T23:59:00+08:00"),
    ).toBe(1);
    expect(routeDayOffset(null, "2026-10-19T00:39:00Z")).toBeNull();
  });
});

describe("candidate refresh is shared but plan scoped", () => {
  it("caches and publishes the entire metadata snapshot on each forced refresh", async () => {
    const context = { routeToken: "plan-one", legIndex: 2 };
    const key = routeDetailKey("82", "Taichung", undefined, context);
    const listener = vi.fn();
    const other = vi.fn();
    const unsub = subscribeRouteDetail(key, listener);
    const unsubOther = subscribeRouteDetail(
      routeDetailKey("82", "Taichung", undefined, { ...context, legIndex: 3 }),
      other,
    );
    try {
      getBusRouteDetail.mockResolvedValueOnce({
        ok: true,
        data: {
          directions: [],
          departureCandidates: candidates,
          candidateSearchComplete: false,
        },
      });
      const first = await fetchRouteDetailSnapshot("82", "Taichung", {
        planContext: context,
      });
      expect(first).toMatchObject({
        departureCandidates: candidates,
        candidateSearchComplete: false,
      });
      getBusRouteDetail.mockResolvedValueOnce({
        ok: true,
        data: {
          directions: [],
          departureCandidates: [],
          candidateSearchComplete: true,
        },
      });
      const next = await fetchRouteDetailSnapshot("82", "Taichung", {
        planContext: context,
        force: true,
      });
      expect(next).toMatchObject({
        departureCandidates: [],
        candidateSearchComplete: true,
      });
      expect(listener).toHaveBeenCalledTimes(2);
      expect(other).not.toHaveBeenCalled();
    } finally {
      unsub();
      unsubOther();
    }
  });
});
