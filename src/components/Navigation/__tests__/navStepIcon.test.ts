import {
  ArrowUp,
  ArrowUpDown,
  ArrowUpLeft,
  Bike,
  Bus,
  Car,
  CornerUpRight,
  Flag,
  Navigation,
  SquareParking,
  TramFront,
} from "lucide-react";
import { describe, expect, it } from "vitest";
import { stepIcon } from "@/components/Navigation/navStepIcon";
import type { NavInstruction } from "@/types/route";

function instruction(overrides: Partial<NavInstruction> = {}): NavInstruction {
  return {
    text: "step",
    type: "turn",
    bearing: null,
    relativeDirection: null,
    distanceM: 100,
    streetName: null,
    legType: "WALK",
    polylineIndex: 0,
    ...overrides,
  };
}

describe("stepIcon — vehicle legs", () => {
  it("uses a car for a driving departure and a bike for a scooter one", () => {
    expect(stepIcon(instruction({ legType: "DRIVE", type: "depart" }))).toBe(
      Car,
    );
    expect(
      stepIcon(instruction({ legType: "MOTORCYCLE", type: "depart" })),
    ).toBe(Bike);
  });

  it("ends a vehicle leg on a parking glyph, not a destination flag", () => {
    expect(stepIcon(instruction({ legType: "DRIVE", type: "arrive" }))).toBe(
      SquareParking,
    );
    expect(
      stepIcon(instruction({ legType: "MOTORCYCLE", type: "facility" })),
    ).toBe(SquareParking);
  });

  it("still shows direction arrows for driving turns", () => {
    expect(
      stepIcon(
        instruction({
          legType: "DRIVE",
          type: "turn",
          relativeDirection: "右側",
        }),
      ),
    ).toBe(CornerUpRight);
  });
});

describe("stepIcon — walking and transit legs", () => {
  it("keeps the pedestrian departure, arrival and facility glyphs", () => {
    expect(stepIcon(instruction({ type: "depart" }))).toBe(Navigation);
    expect(stepIcon(instruction({ type: "arrive" }))).toBe(Flag);
    expect(stepIcon(instruction({ type: "facility" }))).toBe(ArrowUpDown);
  });

  it("distinguishes bus from rail boarding", () => {
    expect(
      stepIcon(instruction({ type: "transit_board", legType: "BUS" })),
    ).toBe(Bus);
    expect(
      stepIcon(instruction({ type: "transit_alight", legType: "METRO" })),
    ).toBe(TramFront);
  });

  it("maps relative directions to arrows and defaults to straight ahead", () => {
    expect(stepIcon(instruction({ relativeDirection: "左前方" }))).toBe(
      ArrowUpLeft,
    );
    expect(stepIcon(instruction())).toBe(ArrowUp);
    expect(stepIcon(undefined)).toBe(ArrowUp);
  });
});
