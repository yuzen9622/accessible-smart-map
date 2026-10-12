import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/fetch", () => ({
  fetchRequest: vi.fn(),
  authenticatedRequest: vi.fn(),
  personalizedRequest: vi.fn(),
  getAccessToken: vi.fn(),
  ApiError: class extends Error {},
}));

import { fetchRequest } from "@/lib/fetch";
import { legSourceName } from "@/lib/route/sourceNames";
import { getAccessibleRoute, rerouteAccessibleRoute } from "../a11y";

const route = () => ({
  routeId: "stable",
  routeToken: "same-token",
  legs: [
    {
      type: "BUS",
      routeName: "紅線",
      routeNameEn: "Red Line",
      routeDisplayName: "Red Line",
      departureStop: "起",
      arrivalStop: "迄",
      polyline: [],
    },
  ],
});
afterEach(() => vi.clearAllMocks());
describe("route display language provenance", () => {
  it("marks a route response and re-renders source names without rerouting", async () => {
    const original = route();
    vi.mocked(fetchRequest).mockResolvedValue({
      ok: true,
      status: "success",
      code: 200,
      message: "",
      data: { routes: [original] },
    });
    const response = await getAccessibleRoute({ language: "en" });
    if (!response.data) throw new Error("Expected route data");
    const leg = response.data.routes[0].legs[0];
    expect(legSourceName(leg, "route", "紅線", "en")).toBe("Red Line");
    expect(legSourceName(leg, "route", "紅線", "zh-TW")).toBe("紅線");
    expect(response.data.routes[0].routeToken).toBe("same-token");
    expect(fetchRequest).toHaveBeenCalledTimes(1);
    expect(original.legs[0].routeName).toBe("紅線");
  });
  it("does not tag a replay's first-language display as the retry language", async () => {
    const replayed = route();
    replayed.legs[0].routeDisplayName = "舊中文display";
    vi.mocked(fetchRequest).mockResolvedValue({
      ok: true,
      status: "success",
      code: 200,
      message: "",
      data: { route: replayed, replayed: true },
    });
    const response = await rerouteAccessibleRoute({
      routeToken: "same-token",
      language: "en",
      clientRequestId: "same-id",
      currentPosition: { latitude: 25, longitude: 121 },
      previousRouteVersion: 1,
      reason: "MANUAL",
    });
    if (!response.data) throw new Error("Expected reroute data");
    const leg = response.data.route.legs[0];
    expect(leg.displayLanguage).toBeUndefined();
    expect(legSourceName(leg, "route", "紅線", "en")).toBe("Red Line");
    expect(response.data.route.routeToken).toBe("same-token");
    expect(vi.mocked(fetchRequest).mock.calls[0][1]?.body).toMatchObject({
      clientRequestId: "same-id",
    });
  });
});
