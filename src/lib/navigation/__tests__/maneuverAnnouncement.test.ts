import { describe, expect, it } from "vitest";
import {
  type ManeuverStage,
  selectManeuverStage,
  stripStepDistance,
} from "../maneuverAnnouncement";

function run(
  distances: number[],
  legType: "WALK" | "MOTORCYCLE",
  straight = false,
): ManeuverStage[] {
  const spoken = new Set<ManeuverStage>();
  let advanceDistanceM: number | null = null;
  const out: ManeuverStage[] = [];
  for (const distanceM of distances) {
    const stage = selectManeuverStage(
      distanceM,
      legType,
      spoken,
      advanceDistanceM,
      straight,
    );
    if (!stage) continue;
    spoken.add(stage);
    if (stage === "advance") advanceDistanceM = distanceM;
    out.push(stage);
  }
  return out;
}

describe("selectManeuverStage", () => {
  it("announces a riding turn early, again within 300 m, then at the turn", () => {
    expect(run([900, 600, 290, 120, 40, 10], "MOTORCYCLE")).toEqual([
      "advance",
      "prepare",
      "now",
    ]);
  });
  it("uses walking distances on foot and skips prepare when advance was already close", () => {
    expect(run([200, 45, 10], "WALK")).toEqual(["advance", "prepare", "now"]);
    expect(run([60, 40, 10], "WALK")).toEqual(["advance", "now"]);
  });
  it("only announces straight steps at the point itself", () => {
    expect(run([900, 290, 40], "MOTORCYCLE", true)).toEqual(["now"]);
  });
});

describe("stripStepDistance", () => {
  it("removes the new continuation phrase without leaving it in turn previews", () => {
    expect(stripStepDistance("向右轉，繼續直行約 400 公尺，注意路口")).toBe(
      "向右轉，注意路口",
    );
    expect(stripStepDistance("沿「信義路」繼續直行約 400 公尺")).toBe(
      "沿「信義路」繼續直行",
    );
  });

  it("drops the step's own segment length", () => {
    expect(stripStepDistance("左轉進入民生路，續行約 200 公尺")).toBe(
      "左轉進入民生路",
    );
    expect(
      stripStepDistance("Turn left onto Minsheng Rd, then continue for 200 m"),
    ).toBe("Turn left onto Minsheng Rd");
  });
});
