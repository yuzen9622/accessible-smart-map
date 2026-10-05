import { describe, expect, it } from "vitest";
import type { RouteDetailDirection } from "@/lib/api/transit";
import {
  busDirectionLabel,
  busDirectionOptions,
  selectBusDirection,
} from "../busDirections";

const fixture = (
  direction: RouteDetailDirection["direction"],
  subRouteUid?: string,
  name = "A",
): RouteDetailDirection => ({
  direction,
  subRouteUid,
  stops: [
    { seq: 1, name, lat: 25, lng: 121, estimateMinutes: null, statusLabel: "" },
  ],
});

describe("TDX direction selection (fixtures)", () => {
  it("has only published options for circular, loop, unknown and empty data", () => {
    for (const direction of [2, 10, 255] as const) {
      const options = busDirectionOptions([fixture(direction)]);
      expect(options).toHaveLength(1);
      expect(selectBusDirection(options, null)?.key).toBe(options[0].key);
    }
    expect(selectBusDirection([], null)).toBeNull();
    expect(
      [0, 1, 2, 10, 255].map((d) =>
        busDirectionLabel(d as RouteDetailDirection["direction"]),
      ),
    ).toEqual([
      "outbound",
      "inbound",
      "busLoop",
      "busCircular",
      "busDirectionUnknown",
    ]);
  });
  it("keeps separate same-direction branches and retains an existing choice", () => {
    const options = busDirectionOptions([fixture(10, "A"), fixture(10, "B")]);
    expect(new Set(options.map((o) => o.key)).size).toBe(2);
    expect(selectBusDirection(options, options[1])?.key).toBe(options[1].key);
    expect(selectBusDirection([...options].reverse(), options[1])?.key).toBe(
      options[1].key,
    );
  });
  it("fallback stays on the chosen branch: zero then first known then unknown", () => {
    const previous = { key: "removed", subRouteUid: "B" };
    const options = busDirectionOptions([
      fixture(0, "A"),
      fixture(255, "B"),
      fixture(10, "B"),
      fixture(0, "B"),
    ]);
    expect(selectBusDirection(options, previous)?.key).toBe(options[3].key);
    expect(selectBusDirection(options.slice(0, 3), previous)?.key).toBe(
      options[2].key,
    );
    expect(selectBusDirection(options.slice(0, 2), previous)?.key).toBe(
      options[1].key,
    );
  });
  it("does not invent IDs or collapse different sequences when IDs are missing", () => {
    const options = busDirectionOptions([
      fixture(10, undefined, "A"),
      fixture(10, undefined, "B"),
    ]);
    expect(options[0].subRouteUid).toBeUndefined();
    expect(options[0].key).not.toBe(options[1].key);
    const refresh = busDirectionOptions([
      {
        ...fixture(10, undefined, "A"),
        stops: [{ ...fixture(10).stops[0], estimateMinutes: 8 }],
      },
    ]);
    expect(refresh[0].key).toBe(options[0].key);
  });
});
