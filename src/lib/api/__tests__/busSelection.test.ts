import { afterEach, describe, expect, it, vi } from "vitest";
import { selectBusDeparture } from "@/lib/api/a11y";
import { END_POINT } from "@/lib/config";
import { departureCandidates } from "@/lib/transit/__tests__/fixtures/departureCandidates";

const request = { routeToken: "old", legIndex: 0, candidateId: "chosen-82" };
const response = () => ({
  ok: true,
  status: "success",
  code: 200,
  message: "OK",
  data: {
    route: {
      routeToken: "selected",
      navigationId: "new-session",
      routeVersion: 1,
      legs: [
        {
          type: "BUS",
          polyline: [
            [121, 25],
            [121.01, 25.01],
          ],
          selectedDeparture: departureCandidates[1],
        },
      ],
    },
  },
});
const serve = (body: unknown) => {
  const fetch = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
};
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bus selection API contract", () => {
  it("posts the selected departure and retains its fresh navigation capability", async () => {
    const fetch = serve(response());
    const signal = new AbortController().signal;
    const result = await selectBusDeparture(request, signal);
    expect(fetch.mock.calls[0]).toEqual([
      `${END_POINT}/api/v1/a11y/accessible-route/bus-selection`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(request),
        signal,
      }),
    ]);
    expect(result.data?.route.routeToken).toBe("selected");
    expect(result.data?.route.legs[0]).toMatchObject({
      selectedDeparture: { plateNumb: "BUS-82" },
    });
  });
  it.each([
    "old-token",
    "missing-identity",
    "missing-selection",
    "bad-geometry",
  ])(
    "rejects a successful response which cannot safely navigate (%s)",
    async (kind) => {
      const body = response();
      if (kind === "old-token") body.data.route.routeToken = "old";
      if (kind === "missing-identity") body.data.route.navigationId = "";
      if (kind === "missing-selection")
        delete (body.data.route.legs[0] as { selectedDeparture?: unknown })
          .selectedDeparture;
      if (kind === "bad-geometry")
        body.data.route.legs[0].polyline = [[121, 25]];
      serve(body);
      await expect(selectBusDeparture(request)).rejects.toThrow(
        "Invalid selected bus route",
      );
    },
  );
});
