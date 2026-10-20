import { describe, expect, it } from "vitest";
import { venueRouteSections } from "../journey";
import { crossCampusJourney } from "./fixtures/crossCampusJourney";

describe("venueRouteSections", () => {
  it("groups the route by the floor or outdoor stretch each step starts on", () => {
    const sections = venueRouteSections(crossCampusJourney());
    expect(
      sections.map((section) => [
        section.buildingName ?? null,
        section.levelRef,
        section.distanceM,
      ]),
    ).toEqual([
      ["East Hall", "3F", 56],
      ["East Hall", "1F", 22],
      [null, null, 79],
      ["West Hall", "1F", 10],
    ]);
  });

  it("keeps a floor change with the floor it leaves and merges a continuous climb", () => {
    const [upper] = venueRouteSections(crossCampusJourney());
    expect(upper.steps.at(-1)).toMatchObject({
      kind: "steps",
      fromLevel: "3F",
      toLevel: "1F",
      distanceM: 36,
    });
  });

  it("drops the zero-length departure marker but keeps building exits and entries", () => {
    const sections = venueRouteSections(crossCampusJourney());
    const steps = sections.flatMap((section) => section.steps);
    expect(steps.some((item) => item.action === "depart")).toBe(false);
    expect(sections[1].steps.at(-1)?.action).toBe("exit");
    expect(sections[2].steps.at(-1)?.action).toBe("enter");
  });

  it("joins a corridor the graph split into edges, but never across a turn", () => {
    const journey = crossCampusJourney();
    const [upperTurn] = venueRouteSections(journey);
    expect(upperTurn.steps.map((item) => item.distanceM)).toEqual([16, 40, 36]);
    delete journey.route.steps[2].maneuver;
    const [upper] = venueRouteSections(journey);
    expect(upper.steps.map((item) => item.distanceM)).toEqual([56, 36]);
    expect(upper.distanceM).toBe(56);
  });
});
