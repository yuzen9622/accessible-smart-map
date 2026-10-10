import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBusRouteDetail,
  searchBusRoutes,
  searchBusStops,
} from "@/lib/api/transit";
import { END_POINT } from "@/lib/config";

function jsonResponse(
  body: unknown,
  status = 200,
  statusText = "OK",
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searchBusRoutes", () => {
  it("requests bus search routes with keyword only when location is omitted", async () => {
    let capturedUrl = "";

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return jsonResponse({
        ok: true,
        data: {
          routes: [
            {
              routeName: "307",
              city: "Taipei",
              departure: "板橋",
              destination: "撫遠街",
            },
          ],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await searchBusRoutes("307");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe(
      `${END_POINT}/api/v1/transit/bus/search-routes?keyword=307`,
    );
    expect(res.ok).toBe(true);
    expect(res.data?.routes).toHaveLength(1);
    expect(res.data?.routes[0].routeName).toBe("307");
  });

  it("includes location query parameter when location is provided", async () => {
    let capturedUrl = "";

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return jsonResponse({
        ok: true,
        data: {
          routes: [
            {
              routeName: "300",
              city: "Taichung",
              departure: "靜宜大學",
              destination: "台中車站",
            },
          ],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await searchBusRoutes("車站", {
      lat: 24.137,
      lng: 120.686,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const parsedUrl = new URL(capturedUrl);
    expect(parsedUrl.pathname).toBe("/api/v1/transit/bus/search-routes");
    expect(parsedUrl.searchParams.get("keyword")).toBe("車站");
    expect(parsedUrl.searchParams.get("location")).toBe("24.137,120.686");
    expect(res.ok).toBe(true);
    expect(res.data?.routes[0].routeName).toBe("300");
  });

  it("handles null or undefined location gracefully", async () => {
    let capturedUrl = "";

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return jsonResponse({
        ok: true,
        data: { routes: [] },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await searchBusRoutes("235", null);
    const parsedUrl = new URL(capturedUrl);
    expect(parsedUrl.searchParams.get("keyword")).toBe("235");
    expect(parsedUrl.searchParams.has("location")).toBe(false);
  });
});

describe("searchBusStops", () => {
  it("requests search-stops endpoint with keyword only when location is omitted", async () => {
    let capturedUrl = "";

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return jsonResponse({
        ok: true,
        data: {
          stops: [
            {
              stopUid: "TPE123",
              stopName: "台北車站(忠孝)",
              city: "Taipei",
              coordinates: [121.517, 25.046],
              routes: ["307", "232"],
            },
          ],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await searchBusStops("台北車站");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const parsedUrl = new URL(capturedUrl);
    expect(parsedUrl.pathname).toBe("/api/v1/transit/bus/search-stops");
    expect(parsedUrl.searchParams.get("keyword")).toBe("台北車站");
    expect(parsedUrl.searchParams.has("location")).toBe(false);
    expect(res.ok).toBe(true);
    expect(res.data?.stops[0].stopName).toBe("台北車站(忠孝)");
  });

  it("includes location query parameter when location is provided", async () => {
    let capturedUrl = "";

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return jsonResponse({
        ok: true,
        data: {
          stops: [
            {
              stopUid: "TXG456",
              stopName: "台中車站(台灣大道)",
              city: "Taichung",
              coordinates: [120.686, 24.137],
              routes: ["300"],
            },
          ],
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await searchBusStops("車站", {
      lat: 24.137,
      lng: 120.686,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const parsedUrl = new URL(capturedUrl);
    expect(parsedUrl.pathname).toBe("/api/v1/transit/bus/search-stops");
    expect(parsedUrl.searchParams.get("keyword")).toBe("車站");
    expect(parsedUrl.searchParams.get("location")).toBe("24.137,120.686");
    expect(res.ok).toBe(true);
    expect(res.data?.stops[0].stopName).toBe("台中車站(台灣大道)");
  });
});

it("sends only the route capability and full leg index for a planned bus", async () => {
  const fetchMock = vi.fn(async (_url: string | URL | Request) =>
    jsonResponse({
      ok: true,
      data: {
        directions: [
          {
            direction: 0,
            stops: [
              {
                seq: 1,
                name: "A",
                lat: 25,
                lng: 121,
                estimateMinutes: 5,
                statusLabel: "正常",
                plateNumb: "BUS-10",
              },
            ],
          },
        ],
      },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const res = await getBusRouteDetail("99", "Taipei", "branch", undefined, {
    routeToken: "plan-token",
    legIndex: 2,
  });
  expect(String(fetchMock.mock.calls[0][0])).toBe(
    `${END_POINT}/api/v1/a11y/accessible-route/bus-arrivals?routeToken=plan-token&legIndex=2`,
  );
  expect(res.data?.directions[0].stops[0].plateNumb).toBe("BUS-10");
});
