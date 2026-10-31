import { describe, expect, it } from "vitest";
import { isValidPlaceBounds } from "../placeBounds";

describe("isValidPlaceBounds", () => {
  it("accepts a non-degenerate geographic extent", () => {
    expect(isValidPlaceBounds([120.6825, 24.1483, 120.6852, 24.1511])).toBe(
      true,
    );
  });

  it.each([
    null,
    undefined,
    [],
    [120, 24, 121],
    [120, 24, 121, Number.NaN],
    [121, 24, 120, 25],
    [120, 25, 121, 24],
    [120, 24, 120, 25],
    [120, 24, 121, 24],
    [-181, 24, 121, 25],
    [120, -91, 121, 25],
    [120, 24, 181, 25],
    [120, 24, 121, 91],
  ])("rejects invalid extents: %s", (bounds) => {
    expect(isValidPlaceBounds(bounds)).toBe(false);
  });
});
