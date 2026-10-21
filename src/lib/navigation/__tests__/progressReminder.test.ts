import { describe, expect, it } from "vitest";
import { selectProgressReminder, spokenDistance } from "../progressReminder";

const none = new Set<number>();

describe("selectProgressReminder", () => {
  it("reminds once at each 500 m mark of the remaining stretch", () => {
    expect(selectProgressReminder(1150, "WALK", none, 1200)).toBeNull();
    expect(selectProgressReminder(998, "WALK", none, 1200)).toBe(1000);
    expect(
      selectProgressReminder(900, "WALK", new Set([1000]), 1200),
    ).toBeNull();
    expect(selectProgressReminder(497, "WALK", new Set([1000]), 1200)).toBe(
      500,
    );
  });

  it("skips a mark right after the step started and leaves the last 50 m to the turn", () => {
    expect(selectProgressReminder(990, "WALK", none, 1080)).toBeNull();
    expect(selectProgressReminder(40, "WALK", none, 600)).toBeNull();
  });

  it("only reminds on walking legs", () => {
    expect(selectProgressReminder(998, "DRIVE", none, 3000)).toBeNull();
    expect(selectProgressReminder(998, "BUS", none, 3000)).toBeNull();
  });
});

describe("spokenDistance", () => {
  it("rounds to 10 m, never says less than 10 m, and switches to km", () => {
    expect(spokenDistance(500)).toEqual({ unit: "m", value: 500 });
    expect(spokenDistance(3)).toEqual({ unit: "m", value: 10 });
    expect(spokenDistance(1500)).toEqual({ unit: "km", value: 1.5 });
  });
});
