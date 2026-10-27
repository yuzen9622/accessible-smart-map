import { beforeEach, describe, expect, it } from "vitest";
import type { AccessibleRoute } from "@/types/route";
import useMapStore from "../useMapStore";

const route: AccessibleRoute = {
  routeId: "walking",
  routeName: "Walking",
  totalMinutes: 5,
  transferCount: 0,
  legs: [],
  accessibilityHighlights: [],
};
beforeEach(() => useMapStore.getState().endRouteSession());

describe("route result travel mode ownership", () => {
  it("keeps the resolved mode when selecting another candidate", () => {
    const second = { ...route, routeId: "other" };
    useMapStore.getState().setComputeRoutes([route, second], "walk");
    useMapStore.getState().setRouteSelect({ index: 1, route: second });
    expect(useMapStore.getState().routeTravelMode).toBe("walk");
  });

  it("does not carry a previous walk mode into legacy results", () => {
    useMapStore.getState().setComputeRoutes([route], "walk");
    useMapStore.getState().setComputeRoutes([route]);
    expect(useMapStore.getState().routeTravelMode).toBeNull();
  });

  it("clears mode on session end and venue journey replacement", () => {
    useMapStore.getState().setComputeRoutes([route], "walk");
    useMapStore.getState().endRouteSession();
    expect(useMapStore.getState().routeTravelMode).toBeNull();
    useMapStore.getState().setComputeRoutes([route], "walk");
    useMapStore.getState().setVenueJourney(null);
    expect(useMapStore.getState().routeTravelMode).toBeNull();
  });
});
