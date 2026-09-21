import { describe, expect, it } from "vitest";
import { buildCumulativePath, resolveWaypoints } from "@/lib/geo";
import type { NavInstruction, RouteLeg } from "@/types/route";
import { withSyntheticPolylineIndices } from "../useNavigation";

const step = (
  text: string,
  overrides: Partial<NavInstruction> = {},
): NavInstruction => ({
  text,
  type: "turn",
  bearing: null,
  relativeDirection: null,
  distanceM: null,
  streetName: null,
  legType: "WALK",
  polylineIndex: null,
  ...overrides,
});

/** A straight line of `count` points heading east from `startLng`. */
const line = (startLng: number, count: number): [number, number][] =>
  Array.from(
    { length: count },
    (_, i) => [startLng + i * 0.001, 25.05] as [number, number],
  );

const legs = (...polylines: [number, number][][]): RouteLeg[] =>
  polylines.map((polyline) => ({
    type: "WALK",
    from: "A",
    to: "B",
    distanceM: 100,
    minutesEst: 2,
    polyline,
    a11yFacilities: [],
  }));

describe("withSyntheticPolylineIndices", () => {
  it("leaves instructions untouched when any of them already has geometry", () => {
    const instructions = [
      step("出發", { polylineIndex: 0 }),
      step("直行"),
      step("抵達"),
    ];
    const cp = buildCumulativePath(legs(line(121.5, 10)));

    expect(withSyntheticPolylineIndices(instructions, cp)).toBe(instructions);
  });

  it("returns the input when there is nothing to spread it over", () => {
    const emptyPath = buildCumulativePath([]);
    const instructions = [step("直行")];

    expect(withSyntheticPolylineIndices([], emptyPath)).toEqual([]);
    expect(withSyntheticPolylineIndices(instructions, emptyPath)).toBe(
      instructions,
    );
  });

  it("makes a voice takeover projectable the moment it happens", () => {
    // Steps handed over by the voice backend carry no polylineIndex.
    const carried = [step("出發"), step("直行"), step("抵達")];
    const cp = buildCumulativePath(legs(line(121.5, 11)));

    // Without geometry every waypoint collapses onto the route origin: that
    // is the state the takeover must never leave turn-by-turn in, since the
    // final waypoint sitting at the origin declares an instant arrival.
    const collapsed = resolveWaypoints(carried, cp);
    expect(collapsed.every((w) => w.alongM === 0)).toBe(true);

    const patched = withSyntheticPolylineIndices(carried, cp);
    const waypoints = resolveWaypoints(patched, cp);

    expect(waypoints).toHaveLength(3);
    expect(waypoints[0]?.alongM).toBe(0);
    // Monotonically advancing waypoints let projection select a next step and
    // the final one sits at the route end so arrival can still fire.
    expect(waypoints[1]?.alongM).toBeGreaterThan(0);
    expect(waypoints[2]?.alongM).toBeGreaterThan(waypoints[1]?.alongM ?? 0);
    expect(waypoints[2]?.alongM).toBe(cp.cumM.at(-1));
    expect(waypoints[2]?.coord).toEqual(cp.path.at(-1));
  });

  it("spreads each step inside its own leg", () => {
    const cp = buildCumulativePath(legs(line(121.5, 5), line(121.6, 5)));
    const carried = [
      step("出發", { legIndex: 0 }),
      step("上車", { legIndex: 0 }),
      step("下車", { legIndex: 1 }),
      step("抵達", { legIndex: 1 }),
    ];

    const patched = withSyntheticPolylineIndices(carried, cp);
    const waypoints = resolveWaypoints(patched, cp);

    // polylineIndex is leg-relative, so both legs restart at 0.
    expect(patched.map((i) => i.polylineIndex)).toEqual([0, 4, 0, 4]);
    // The second leg's waypoints must land inside the second leg's points.
    expect(waypoints[2]?.coord).toEqual(cp.path[5]);
    expect(waypoints[3]?.coord).toEqual(cp.path.at(-1));
  });

  it("pins a single carried step to the end of the route", () => {
    const cp = buildCumulativePath(legs(line(121.5, 6)));
    const patched = withSyntheticPolylineIndices([step("抵達")], cp);

    expect(patched[0]?.polylineIndex).toBe(5);
    expect(resolveWaypoints(patched, cp)[0]?.alongM).toBe(cp.cumM.at(-1));
  });
});
