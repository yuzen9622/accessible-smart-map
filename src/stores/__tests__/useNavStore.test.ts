import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useNavStore from "@/stores/useNavStore";
import type { NavInstruction } from "@/types/route";

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
