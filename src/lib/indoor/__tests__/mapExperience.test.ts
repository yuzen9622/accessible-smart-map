import { describe, expect, it } from "vitest";
import { getIndoorExitZoom, shouldLeaveIndoor } from "../mapExperience";

describe("indoor map exit threshold", () => {
  it.each([20, 18.5])(
    "uses the same relative scale after a viewport fit at zoom %s",
    (entryZoom) => {
      const exitZoom = getIndoorExitZoom(entryZoom);
      expect(exitZoom).toBe(entryZoom - 0.9);
      expect(2 ** (entryZoom - exitZoom)).toBeCloseTo(2 ** 0.9, 12);
      const state = { entryZoom, entering: false, is3D: true };
      expect(shouldLeaveIndoor({ ...state, zoom: exitZoom + 0.000001 })).toBe(
        false,
      );
      expect(shouldLeaveIndoor({ ...state, zoom: exitZoom })).toBe(true);
      expect(shouldLeaveIndoor({ ...state, zoom: exitZoom - 1 })).toBe(true);
    },
  );

  it("ignores low zoom during the initial flight and until its fitted zoom is captured", () => {
    expect(
      shouldLeaveIndoor({
        zoom: 11,
        entryZoom: 20,
        entering: true,
        is3D: true,
      }),
    ).toBe(false);
    expect(
      shouldLeaveIndoor({
        zoom: 11,
        entryZoom: null,
        entering: true,
        is3D: true,
      }),
    ).toBe(false);
    expect(
      shouldLeaveIndoor({
        zoom: 11,
        entryZoom: null,
        entering: false,
        is3D: true,
      }),
    ).toBe(false);
    expect(
      shouldLeaveIndoor({
        zoom: 20,
        entryZoom: 20,
        entering: false,
        is3D: true,
      }),
    ).toBe(false);
  });

  it("leaves immediately for an explicit 2D switch, including during entry", () => {
    for (const entering of [true, false])
      for (const entryZoom of [null, 20])
        expect(
          shouldLeaveIndoor({ zoom: 22, entryZoom, entering, is3D: false }),
        ).toBe(true);
  });

  it("is stateless across zoom-out and zoom-in calls and never changes caller state", () => {
    const state = Object.freeze({
      zoom: 18,
      entryZoom: 20,
      entering: false,
      is3D: true,
    });
    expect(shouldLeaveIndoor(state)).toBe(true);
    expect(shouldLeaveIndoor({ ...state, zoom: 21 })).toBe(false);
    expect(shouldLeaveIndoor(state)).toBe(true);
    expect(state.zoom).toBe(18);
  });

  it("does not interpret missing finite camera readings as a zoom exit", () => {
    for (const value of [Number.NaN, Infinity, -Infinity]) {
      expect(
        shouldLeaveIndoor({
          zoom: value,
          entryZoom: 20,
          entering: false,
          is3D: true,
        }),
      ).toBe(false);
      expect(
        shouldLeaveIndoor({
          zoom: 18,
          entryZoom: value,
          entering: false,
          is3D: true,
        }),
      ).toBe(false);
    }
  });
});
