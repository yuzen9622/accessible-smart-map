import { beforeEach, describe, expect, it } from "vitest";
import useNavStore from "@/stores/useNavStore";
import type { AccessibleRoute, BusLeg, NavInstruction } from "@/types/route";
import { resumedTransit } from "../navTransit";
import type { VoiceNavStep } from "../voiceSession";

const bus = (name: string, from: string, to: string) =>
  ({
    type: "BUS",
    routeName: name,
    departureStop: from,
    arrivalStop: to,
  }) as BusLeg;
const route = {
  legs: [bus("藍7", "市府", "松山"), bus("307", "松山", "公館")],
} as AccessibleRoute;
const steps = [
  { type: "transit_board", legType: "BUS", isTransit: true },
  { type: "transit_alight", legType: "BUS", isTransit: true },
  { type: "transit_board", legType: "BUS", isTransit: true },
] as VoiceNavStep[];

beforeEach(() => useNavStore.getState().reset());
describe("backend-owned transit snapshot", () => {
  it("restores the correct repeated-mode leg rather than the first bus", () => {
    expect(resumedTransit(route, steps, 2, true)).toEqual({
      onVehicle: true,
      leg: { mode: "BUS", from: "松山", to: "公館", routeName: "307" },
    });
  });
  it("does not invent a route when legacy steps are ambiguous", () => {
    expect(
      resumedTransit(route, [{ legType: "BUS" }] as VoiceNavStep[], 0, true),
    ).toEqual({ onVehicle: true, leg: null });
  });
  it("adopts the backend's not-on-vehicle state", () => {
    expect(resumedTransit(route, steps, 0, false)).toBeNull();
  });
  it.each(["arrived", "local", "instructions", "walking", "alighting"])(
    "clears stale transit on %s",
    (transition) => {
      const nav = useNavStore.getState();
      nav.setNavigationSource("voice");
      nav.setInstructions([
        { type: "turn", legType: "WALK" },
        { type: "transit_alight", legType: "BUS" },
      ] as NavInstruction[]);
      useNavStore.setState({
        voiceTransit: {
          onVehicle: true,
          leg: { mode: "BUS", from: "市府", to: "松山" },
        },
      });
      if (transition === "arrived") nav.setArrived(true);
      else if (transition === "local") nav.setNavigationSource("local");
      else if (transition === "instructions") nav.setInstructions([]);
      else nav.applyVoiceStep(transition === "walking" ? 0 : 1, "下一步", 10);
      expect(useNavStore.getState().voiceTransit).toBeNull();
    },
  );
});
