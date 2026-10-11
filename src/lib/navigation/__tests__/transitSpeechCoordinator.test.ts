import { describe, expect, it } from "vitest";
import type { NavInstruction } from "@/types/route";
import {
  createTransitSpeechCoordinator,
  type TransitSpeechFrame,
} from "../transitSpeechCoordinator";

const instructions = [
  { type: "transit_board", legType: "BUS", legIndex: 0 },
  { type: "transit_alight", legType: "BUS", legIndex: 0 },
  { type: "turn", legType: "WALK", legIndex: 1, text: "walk" },
] as NavInstruction[];
const riding: TransitSpeechFrame = {
  scope: "route/session/version/local/live",
  instructions,
  index: 1,
  rideKey: "bus0",
  guide: {
    phase: "riding",
    routeName: "99",
    alightStop: "C",
    stopsLeft: 2,
    minutes: null,
    minutesSource: null,
  },
};
describe("HUD transit/generic speech coordination", () => {
  it("retains the prior run across GPS exit → guide/ride null and gives alight priority over WALK", () => {
    const frame = createTransitSpeechCoordinator();
    frame(riding);
    const exit = { ...riding, index: 2, rideKey: undefined, guide: null };
    expect(frame(exit)).toEqual({
      speech: { kind: "alight", alightStop: "C" },
      generic: false,
    });
    // A second render of guide-null must not cancel the alight with the WALK instruction.
    expect(frame(exit)).toEqual({ speech: null, generic: false });
  });
  it("does not repeat after 2→0 announcement and a subsequent step exit", () => {
    const frame = createTransitSpeechCoordinator();
    frame(riding);
    const zero = {
      ...riding,
      guide: {
        phase: "riding" as const,
        routeName: "99",
        alightStop: "C",
        stopsLeft: 0,
        minutes: null,
        minutesSource: null,
      },
    };
    expect(frame(zero).speech?.kind).toBe("alight");
    expect(
      frame({ ...zero, index: 2, guide: null, rideKey: undefined }).speech,
    ).toBeNull();
  });
  it("does not carry the old boarded/alight dedup into a direct transfer", () => {
    const frame = createTransitSpeechCoordinator();
    const transferSteps = [
      ...instructions.slice(0, 2),
      ...instructions.slice(0, 2).map((s) => ({ ...s, legIndex: 1 })),
    ];
    frame({ ...riding, instructions: transferSteps });
    const transfer: TransitSpeechFrame = {
      ...riding,
      instructions: transferSteps,
      index: 2,
      rideKey: "bus1",
      guide: {
        phase: "waiting",
        routeName: "100",
        boardStop: "C",
        waitMinutes: null,
      },
    };
    expect(frame(transfer).speech?.kind).toBe("alight");
    expect(
      frame({
        ...transfer,
        guide: {
          phase: "riding",
          routeName: "100",
          alightStop: "D",
          stopsLeft: 2,
          minutes: null,
          minutesSource: null,
        },
      }).speech?.kind,
    ).toBe("boarded");
  });
  it.each([
    { scope: "new-route" },
    { scope: "new-session" },
    { scope: "new-version" },
    { scope: null },
    { instructions: [...instructions] },
    { index: 0 },
  ])(
    "cleanup/reset/ownership changes cannot generate an old alight (%j)",
    (change) => {
      const frame = createTransitSpeechCoordinator();
      frame(riding);
      expect(
        frame({
          ...riding,
          index: 2,
          guide: null,
          rideKey: undefined,
          ...change,
        }).speech,
      ).toBeNull();
    },
  );
  it("voice takeover/preview invalidate history even if the same scope later returns", () => {
    const frame = createTransitSpeechCoordinator();
    frame(riding);
    frame({ ...riding, scope: null });
    expect(
      frame({ ...riding, index: 2, guide: null, rideKey: undefined }).speech,
    ).toBeNull();
  });
});
