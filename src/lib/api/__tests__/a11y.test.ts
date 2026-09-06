import { afterEach, describe, expect, it, vi } from "vitest";
import { createHazardReport, rerouteAccessibleRoute } from "@/lib/api/a11y";
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
