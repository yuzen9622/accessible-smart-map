import { describe, expect, it } from "vitest";
import { navigationRoadLabel } from "../instructionPresentation";

const t = (key: string) => key;

describe("navigationRoadLabel", () => {
  it("shows only the road name for a walking maneuver", () => {
    expect(
      navigationRoadLabel(
        {
          type: "depart",
          text: "沿「永春東三路」出發，續行約 190 公尺，方位約 20 度（北）",
          streetName: " 永春東三路 ",
        },
        false,
        t,
      ),
    ).toBe("永春東三路");
  });

  it("falls back to the instruction text when the step has no road", () => {
    expect(
      navigationRoadLabel(
        { type: "facility", text: "搭乘電梯", streetName: null },
        false,
        t,
      ),
    ).toBe("搭乘電梯");
    expect(
      navigationRoadLabel(
        { type: "turn", text: "右轉", streetName: "  " },
        false,
        t,
      ),
    ).toBe("右轉");
  });

  it("keeps facility and transit text even when a road is attached", () => {
    expect(
      navigationRoadLabel(
        { type: "facility", text: "搭乘電梯", streetName: "永春東三路" },
        false,
        t,
      ),
    ).toBe("搭乘電梯");
    expect(
      navigationRoadLabel(
        {
          type: "transit_board",
          text: "搭乘 270 公車",
          streetName: "忠孝東路",
        },
        false,
        t,
      ),
    ).toBe("搭乘 270 公車");
  });

  it("keeps the destination copy for the arrive step", () => {
    expect(
      navigationRoadLabel(
        { type: "arrive", text: "抵達", streetName: "忠孝東路" },
        false,
        t,
      ),
    ).toBe("navContinueToDestination");
  });

  it("reports preparing when there is no step yet", () => {
    expect(navigationRoadLabel(undefined, false, t)).toBe("preparingNav");
  });
});
