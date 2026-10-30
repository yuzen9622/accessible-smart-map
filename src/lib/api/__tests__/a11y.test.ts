import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createHazardReport,
  getAccessibleRoute,
  getHazardReport,
  getMyHazardReports,
  getNearbyRouteA11yPlaces,
  getRouteInstructions,
  rerouteAccessibleRoute,
} from "@/lib/api/a11y";
import { END_POINT } from "@/lib/config";
import { ApiError } from "@/lib/fetch";
import useAuthStore from "@/stores/useAuthStore";

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

function htmlResponse(
  _html: string,
  status = 502,
  statusText = "Bad Gateway",
): Response {
  return {
    ok: false,
    status,
    statusText,
    json: async () => {
      throw new SyntaxError("Unexpected token < in JSON at position 0");
    },
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ session: null, user: null });
});

describe("createHazardReport", () => {
  it("resolves ok:true with hazard report data on 200/201 success", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody: FormData | undefined;

    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedMethod = init?.method ?? "GET";
        capturedBody = init?.body as FormData;

        return jsonResponse({
          ok: true,
          code: 201,
          message: "Report created",
          data: {
            _id: "report-123",
            hazardType: "obstacle",
            latitude: 25.03396,
            longitude: 121.56447,
          },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const formData = new FormData();
    formData.append("hazardType", "obstacle");
    formData.append("severity", "difficult");
    formData.append("latitude", "25.03396");
    formData.append("longitude", "121.56447");

    const res = await createHazardReport(formData);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toBe(`${END_POINT}/api/v1/a11y/reports`);
    expect(capturedMethod).toBe("POST");
    expect(capturedBody).toBe(formData);
    expect(res.ok).toBe(true);
    expect(res.data?._id).toBe("report-123");
  });

  it("throws ApiError when backend returns a 400 JSON error envelope", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          ok: false,
          code: 400,
          message: "Invalid hazard report payload",
        },
        400,
        "Bad Request",
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const formData = new FormData();
    formData.append("hazardType", "invalid");

    await expect(createHazardReport(formData)).rejects.toThrow(ApiError);
    await expect(createHazardReport(formData)).rejects.toMatchObject({
      code: 400,
      message: "Invalid hazard report payload",
    });
  });

  it("gracefully catches non-JSON error pages (502/504 HTML) and throws ApiError", async () => {
    const fetchMock = vi.fn(async () =>
      htmlResponse(
        "<html><body>502 Bad Gateway</body></html>",
        502,
        "Bad Gateway",
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const formData = new FormData();
    formData.append("hazardType", "obstacle");

    await expect(createHazardReport(formData)).rejects.toThrow(ApiError);
    await expect(createHazardReport(formData)).rejects.toMatchObject({
      code: 502,
      message: "Bad Gateway",
    });
  });

  it("attaches Authorization header when user is authenticated", async () => {
    useAuthStore.setState({
      session: {
        accessToken: "test-jwt-token",
      },
    });

    let capturedHeaders: Record<string, string> = {};
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return jsonResponse({
          ok: true,
          code: 200,
          data: { _id: "report-123" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const formData = new FormData();
    await createHazardReport(formData);

    expect(capturedHeaders.Authorization).toBe("Bearer test-jwt-token");
  });
});

describe("hazard v2 API contracts", () => {
  it("GET by ID forwards abort signal and preserves public v2 report envelope", async () => {
    const controller = new AbortController();
    const report = {
      _id: "r1",
      aiReview: {
        version: 2,
        state: "queued",
        reasonCode: "QUEUED",
        reason: "Queued",
      },
    };
    const mock = vi.fn(async () =>
      jsonResponse({ ok: true, code: 200, data: { report } }),
    );
    vi.stubGlobal("fetch", mock);
    expect((await getHazardReport("r1", controller.signal)).data).toEqual({
      report,
    });
    expect(mock).toHaveBeenCalledWith(
      `${END_POINT}/api/v1/a11y/reports/r1`,
      expect.objectContaining({ signal: controller.signal }),
    );
  });
  it("encodes mine cursors and forwards cancellation", async () => {
    const controller = new AbortController();
    const mock = vi.fn(async () =>
      jsonResponse({
        ok: true,
        data: { reports: [], total: 0, nextCursor: null },
      }),
    );
    vi.stubGlobal("fetch", mock);
    await getMyHazardReports("cursor&value", controller.signal);
    expect(mock).toHaveBeenCalledWith(
      `${END_POINT}/api/v1/a11y/reports/mine?cursor=cursor%26value`,
      expect.objectContaining({ signal: controller.signal }),
    );
  });
  it("mine returns reports/total/nextCursor, not an array", async () => {
    const data = { reports: [{ _id: "r1" }], total: 2, nextCursor: "cursor" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true, code: 200, data })),
    );
    expect((await getMyHazardReports()).data).toEqual(data);
  });
  it.each([201, 200])(
    "create %i preserves report and merged",
    async (status) => {
      const data = {
        report: { _id: "r1", aiReview: { version: 2, state: "queued" } },
        ...(status === 200 ? { merged: true } : {}),
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse({ ok: true, code: status, data }, status),
        ),
      );
      expect((await createHazardReport(new FormData())).data).toEqual(data);
    },
  );
  it.each([
    "IMAGE_INVALID",
    "IMAGE_UNSUPPORTED",
    "IMAGE_TOO_LARGE",
    "REPORT_COMMIT_UNCERTAIN",
  ])("preserves %s and optional uncertain reportId", async (reason) => {
    const data = { reason, reportId: "uncertain-id" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: false, code: 400, data }, 400)),
    );
    await expect(createHazardReport(new FormData())).rejects.toMatchObject({
      reason,
      data,
    });
  });
  it("aborted GET rejection is preserved", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.signal?.aborted)
          throw new DOMException("Aborted", "AbortError");
        throw new Error("signal missing");
      }),
    );
    await expect(
      getHazardReport("r1", controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("accessible route i18n transport", () => {
  const detail = {
    index: 0,
    code: "ROUTE_DATA_SPARSE",
    message: "Limited data",
    params: {},
  };
  const route = {
    routeId: "r1",
    warnings: ["Route warning"],
    warningDetails: [{ ...detail, message: "Route detail" }],
    scoreWarnings: ["Limited data"],
    scoreWarningDetails: [detail],
    accessibilityHighlights: ["Caution"],
    accessibilityHighlightDetails: [
      { ...detail, code: "ROUTE_PARTIAL_ACCESSIBILITY" },
    ],
  };
  it.each(["en", "zh-TW", undefined] as const)(
    "forwards language %s and all optional details unchanged",
    async (language) => {
      const data = { routes: [route] };
      const fetchMock = vi.fn(async () => jsonResponse({ ok: true, data }));
      vi.stubGlobal("fetch", fetchMock);
      const request = {
        origin: "A",
        destination: "B",
        ...(language ? { language } : {}),
      };
      expect((await getAccessibleRoute(request)).data).toEqual(data);
      const [url, init] = (
        fetchMock.mock.calls as unknown as [string, RequestInit][]
      )[0];
      expect(url).toBe(`${END_POINT}/api/v1/a11y/accessible-route`);
      expect(JSON.parse(init.body as string)).toEqual(request);
      expect(new Headers(init.headers).has("Accept-Language")).toBe(false);
    },
  );
  it("preserves the separate reroute envelope and nested route indices", async () => {
    const data = {
      route,
      warnings: ["Envelope warning"],
      warningDetails: [detail],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ ok: true, data })),
    );
    expect(
      (
        await rerouteAccessibleRoute({
          routeToken: "token",
          currentPosition: { latitude: 25, longitude: 121 },
          previousRouteVersion: 1,
          reason: "MANUAL",
          clientRequestId: "request",
          language: "en",
        })
      ).data,
    ).toEqual(data);
  });
  it("reads the domain reason from data while keeping numeric code as HTTP status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            ok: false,
            code: 422,
            message: "No accessible route",
            data: { reason: "NO_ACCESSIBLE_ROUTE" },
          },
          422,
        ),
      ),
    );
    await expect(getAccessibleRoute({ language: "en" })).rejects.toMatchObject({
      code: 422,
      reason: "NO_ACCESSIBLE_ROUTE",
    });
  });
});

describe("rerouteAccessibleRoute", () => {
  it("POSTs the frozen reroute body without destination or preferences", async () => {
    const body = {
      routeToken: "route-token-v1",
      currentPosition: {
        latitude: 25.033,
        longitude: 121.565,
        accuracy: 8,
      },
      previousRouteVersion: 1,
      reason: "OFF_ROUTE" as const,
      clientRequestId: "73e27df0-f3fa-4bf2-9320-da6bcb83d51a",
    };
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        capturedInit = init;
        return jsonResponse({
          ok: true,
          code: 200,
          data: {
            navigationId: "nav-1",
            previousRouteVersion: 1,
            routeVersion: 2,
            routeToken: "route-token-v2",
            route: { routeId: "route-v2" },
            instructions: [],
            warnings: [],
            currentStepIndex: 0,
            replayed: false,
          },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await rerouteAccessibleRoute(body);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `${END_POINT}/api/v1/a11y/accessible-route/reroute`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    expect(capturedInit).toBeDefined();
    const sent = JSON.parse(capturedInit?.body as string);
    expect(Object.keys(sent).sort()).toEqual([
      "clientRequestId",
      "currentPosition",
      "previousRouteVersion",
      "reason",
      "routeToken",
    ]);
    expect(sent).not.toHaveProperty("destination");
    expect(sent).not.toHaveProperty("preferences");
  });

  it.each([409, 410, 422, 503])(
    "preserves the reroute HTTP error code %i",
    async (code) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          jsonResponse(
            { ok: false, code, message: `reroute failed ${code}` },
            code,
            "Error",
          ),
        ),
      );

      await expect(
        rerouteAccessibleRoute({
          routeToken: "route-token-v1",
          currentPosition: { latitude: 25.033, longitude: 121.565 },
          previousRouteVersion: 1,
          reason: "OFF_ROUTE",
          clientRequestId: "73e27df0-f3fa-4bf2-9320-da6bcb83d51a",
        }),
      ).rejects.toMatchObject({ code, message: `reroute failed ${code}` });
    },
  );
});

it("requests instructions with only token, heading and language, never the full route", async () => {
  const fetchMock = vi.fn(async () =>
    jsonResponse({
      ok: true,
      data: { instructions: [], totalSteps: 0, warnings: [] },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const request = {
    routeToken: "fixture-token",
    userHeading: 45,
    language: "en" as const,
    route: { secretGeometry: true },
    origin: { lat: 25, lng: 121 },
  };
  await getRouteInstructions(request);
  const init = (
    fetchMock.mock.calls as unknown as [string, RequestInit][]
  )[0][1];
  expect(JSON.parse(init.body as string)).toEqual({
    routeToken: "fixture-token",
    userHeading: 45,
    language: "en",
  });
});

describe("getNearbyRouteA11yPlaces", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the place extent as bbox", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      jsonResponse({ ok: true, code: 200, data: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getNearbyRouteA11yPlaces(
      { lat: 24.1372, lng: 120.6867 },
      undefined,
      "zh-TW",
      [120.6853, 24.1359, 120.6881, 24.1387],
    );

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/api/v1/a11y/nearby-a11y");
    expect(url.searchParams.get("lat")).toBe("24.1372");
    expect(url.searchParams.get("lng")).toBe("120.6867");
    expect(url.searchParams.get("lang")).toBe("zh-TW");
    expect(url.searchParams.get("bbox")).toBe(
      "120.6853,24.1359,120.6881,24.1387",
    );
  });

  it("omits bbox when the place has no extent", async () => {
    const fetchMock = vi.fn(async (_url: string) =>
      jsonResponse({ ok: true, code: 200, data: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getNearbyRouteA11yPlaces({ lat: 25, lng: 121.5 }, undefined, "en");

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.searchParams.has("bbox")).toBe(false);
  });
});
