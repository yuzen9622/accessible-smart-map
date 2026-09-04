import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useNavStore, { type NavAdvisory } from "@/stores/useNavStore";
import type { NavInstruction } from "@/types/route";

function advisory(overrides: Partial<NavAdvisory> & { advisoryId: string }) {
  return {
    category: "facility",
    severity: "warning",
    action: "reroute_suggested",
    title: "電梯維修中",
    speech: "前方站體電梯維修中",
    issuedAt: "2026-09-04T00:00:00.000Z",
    ...overrides,
  } satisfies NavAdvisory;
}

const instruction: NavInstruction = {
  text: "向前直行",
  type: "depart",
  bearing: null,
  relativeDirection: null,
  distanceM: 100,
  streetName: null,
  legType: "WALK",
  polylineIndex: null,
};

describe("useNavStore progress", () => {
  beforeEach(() => {
    useNavStore.setState({ compassPermission: "unknown" });
    useNavStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("patches only the supplied progress fields", () => {
    useNavStore.setState({ remainingM: 240 });

    useNavStore.getState().setProgress({ remainingDurationSec: 75 });

    expect(useNavStore.getState()).toMatchObject({
      remainingM: 240,
      remainingDurationSec: 75,
    });
  });

  it("updates etaUpdatedAt only for ETA fields", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_710_000_000_000);

    useNavStore.getState().setProgress({ remainingDurationSec: 90 });
    expect(useNavStore.getState().etaUpdatedAt).toBe(1_710_000_000_000);

    useNavStore.setState({ etaUpdatedAt: 123 });
    useNavStore.getState().setProgress({ distanceToNextM: 12 });
    expect(useNavStore.getState().etaUpdatedAt).toBe(123);
  });

  it("ignores undefined etaSource but clears it with null", () => {
    useNavStore.setState({ etaSource: "realtime" });

    useNavStore.getState().setProgress({ etaSource: undefined });
    expect(useNavStore.getState().etaSource).toBe("realtime");

    useNavStore.getState().setProgress({ etaSource: null });
    expect(useNavStore.getState().etaSource).toBeNull();
  });

  it("timestamps effective ETA updates, including null clears", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_710_000_000_000);
    useNavStore.setState({
      remainingDurationSec: 90,
      etaUpdatedAt: 123,
    });

    useNavStore.getState().setProgress({ remainingDurationSec: undefined });
    expect(useNavStore.getState()).toMatchObject({
      remainingDurationSec: 90,
      etaUpdatedAt: 123,
    });

    useNavStore.getState().setProgress({ estimatedArrivalAt: null });
    expect(useNavStore.getState()).toMatchObject({
      estimatedArrivalAt: null,
      etaUpdatedAt: 1_710_000_000_000,
    });
  });

  it("clears explicitly null progress fields", () => {
    useNavStore.setState({
      remainingM: 240,
      remainingDurationSec: 75,
      estimatedArrivalAt: 1_710_000_000_000,
      etaSource: "realtime",
      distanceToNextM: 12,
    });

    useNavStore.getState().setProgress({
      remainingM: null,
      remainingDurationSec: null,
      estimatedArrivalAt: null,
      etaSource: null,
      distanceToNextM: null,
    });

    expect(useNavStore.getState()).toMatchObject({
      remainingM: null,
      remainingDurationSec: null,
      estimatedArrivalAt: null,
      etaSource: null,
      distanceToNextM: null,
    });
  });

  it("clears ETA fields when instructions are replaced", () => {
    useNavStore.getState().setProgress({
      remainingDurationSec: 75,
      estimatedArrivalAt: 1_710_000_000_000,
      etaSource: "realtime",
    });

    useNavStore.getState().setInstructions([instruction]);

    expect(useNavStore.getState()).toMatchObject({
      remainingDurationSec: null,
      estimatedArrivalAt: null,
      etaSource: null,
      etaUpdatedAt: null,
    });
  });

  it("resets ETA fields while retaining compass permission", () => {
    useNavStore.getState().setCompassPermission("granted");
    useNavStore.getState().setProgress({
      remainingDurationSec: 75,
      estimatedArrivalAt: 1_710_000_000_000,
      etaSource: "local",
    });

    useNavStore.getState().reset();

    expect(useNavStore.getState()).toMatchObject({
      remainingDurationSec: null,
      estimatedArrivalAt: null,
      etaSource: null,
      etaUpdatedAt: null,
      compassPermission: "granted",
    });
  });
});

describe("useNavStore advisories", () => {
  beforeEach(() => {
    useNavStore.setState({ compassPermission: "unknown" });
    useNavStore.getState().reset();
  });

  it("overwrites an advisory carrying an already-known advisoryId", () => {
    useNavStore.getState().pushAdvisories([advisory({ advisoryId: "a" })]);
    useNavStore
      .getState()
      .pushAdvisories([advisory({ advisoryId: "a", title: "電梯已恢復" })]);

    expect(useNavStore.getState().advisories).toHaveLength(1);
    expect(useNavStore.getState().advisories[0].title).toBe("電梯已恢復");
  });

  it("keeps at most three advisories, newest first", () => {
    useNavStore
      .getState()
      .pushAdvisories([
        advisory({ advisoryId: "a", issuedAt: "2026-09-04T00:00:01.000Z" }),
        advisory({ advisoryId: "b", issuedAt: "2026-09-04T00:00:02.000Z" }),
        advisory({ advisoryId: "c", issuedAt: "2026-09-04T00:00:03.000Z" }),
        advisory({ advisoryId: "d", issuedAt: "2026-09-04T00:00:04.000Z" }),
      ]);

    expect(useNavStore.getState().advisories.map((a) => a.advisoryId)).toEqual([
      "d",
      "c",
      "b",
    ]);
  });

  it("dismisses only the requested advisory", () => {
    useNavStore
      .getState()
      .pushAdvisories([
        advisory({ advisoryId: "a" }),
        advisory({ advisoryId: "b" }),
      ]);

    useNavStore.getState().dismissAdvisory("a");

    expect(useNavStore.getState().advisories.map((a) => a.advisoryId)).toEqual([
      "b",
    ]);
  });

  it("clears advisories and the reroute reason when instructions are replaced", () => {
    useNavStore.getState().pushAdvisories([advisory({ advisoryId: "a" })]);
    useNavStore.getState().setLastRerouteReason("FACILITY_OUTAGE");

    useNavStore.getState().setInstructions([instruction]);

    expect(useNavStore.getState()).toMatchObject({
      advisories: [],
      lastRerouteReason: null,
    });
  });

  it("clears advisories on arrival but keeps them otherwise", () => {
    useNavStore.getState().pushAdvisories([advisory({ advisoryId: "a" })]);

    useNavStore.getState().setArrived(false);
    expect(useNavStore.getState().advisories).toHaveLength(1);

    useNavStore.getState().setArrived(true);
    expect(useNavStore.getState().advisories).toEqual([]);
  });

  it("resets advisory state back to its initial shape", () => {
    useNavStore.getState().pushAdvisories([advisory({ advisoryId: "a" })]);
    useNavStore.getState().setLastRerouteReason("CONFIRMED_HAZARD");

    useNavStore.getState().reset();

    expect(useNavStore.getState()).toMatchObject({
      advisories: [],
      lastRerouteReason: null,
    });
  });
});
