import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearReverseGeocodeCache,
  getPlaceAutocomplete,
  getPlaceDetails,
  reverseGeocode,
} from "@/lib/api/placeSearch";
import { END_POINT } from "@/lib/config";
import { ApiError } from "@/lib/fetch";

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

beforeEach(() => {
  clearReverseGeocodeCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reverseGeocode", () => {
  const mockNominatimData = {
    place_id: 12345,
    osm_id: 67890,
    osm_type: "node",
    lat: "25.03396",
    lon: "121.56447",
    display_name: "台北市信義區市府路1號",
    name: "台北市政府",
    address: {
      city: "台北市",
      city_district: "信義區",
      road: "市府路",
      house_number: "1號",
      country: "臺灣",
      country_code: "tw",
    },
  };

  it("fetches reverse geocoding with object parameters and formats result", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};

    const fetchMock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        capturedUrl = String(url);
        capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
        return jsonResponse(mockNominatimData);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await reverseGeocode({
      lat: 25.03396,
      lng: 121.56447,
      lang: "zh-TW",
      zoom: 18,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(capturedUrl).toContain(
      "https://nominatim.openstreetmap.org/reverse",
    );
    expect(capturedUrl).toContain("lat=25.03396");
    expect(capturedUrl).toContain("lon=121.56447");
    expect(capturedUrl).toContain("accept-language=zh-TW");
    expect(capturedUrl).toContain("zoom=18");
    expect(capturedUrl).toContain("addressdetails=1");
    expect(capturedHeaders["Accept-Language"]).toBe("zh-TW");

    expect(result).not.toBeNull();
    expect(result?.place_id).toBe(12345);
    expect(result?.name).toBe("台北市政府");
  });

  it("supports positional parameters (lat, lng, lang, options)", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("zoom=16");
      expect(String(url)).toContain("accept-language=en");
      return jsonResponse(mockNominatimData);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await reverseGeocode(25.03396, 121.56447, "en", {
      zoom: 16,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).not.toBeNull();
  });

  it("caches responses for repeated calls with same coordinates", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(mockNominatimData));
    vi.stubGlobal("fetch", fetchMock);

    const res1 = await reverseGeocode({
      lat: 25.03396,
      lng: 121.56447,
      lang: "zh-TW",
    });
    const res2 = await reverseGeocode({
      lat: 25.03396,
      lng: 121.56447,
      lang: "zh-TW",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res1).toEqual(res2);
  });

  it("clears cache via clearReverseGeocodeCache", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(mockNominatimData));
    vi.stubGlobal("fetch", fetchMock);

    await reverseGeocode({ lat: 25.03396, lng: 121.56447, lang: "zh-TW" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clearReverseGeocodeCache();

    await reverseGeocode({ lat: 25.03396, lng: 121.56447, lang: "zh-TW" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null for non-finite coordinates", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await reverseGeocode({ lat: Number.NaN, lng: 121.56447 });
    expect(res).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when Nominatim returns an error payload", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: "Unable to geocode" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await reverseGeocode({ lat: 0, lng: 0 });
    expect(res).toBeNull();
  });

  it("throws ApiError when HTTP status is not ok (e.g. 500 / 429)", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({}, 500, "Internal Server Error"),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      reverseGeocode({ lat: 25.03396, lng: 121.56447 }),
    ).rejects.toThrow(ApiError);
  });

  it("passes AbortSignal to fetch request", async () => {
    const controller = new AbortController();
    let passedSignal: AbortSignal | undefined;

    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        passedSignal = init?.signal as AbortSignal;
        return jsonResponse(mockNominatimData);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await reverseGeocode({ lat: 25.03396, lng: 121.56447 }, controller.signal);

    expect(passedSignal).toBe(controller.signal);
  });
});

describe("getPlaceAutocomplete and getPlaceDetails", () => {
  it("calls search autocomplete endpoint with query parameters", async () => {
    const suggestion = {
      id: "osm:node:123",
      source: "osm",
      primaryText: "Taipei 101",
      secondaryText: "Xinyi",
      placeClass: "building",
      placeType: "commercial",
      typeLabel: "Building",
    };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain(
        `${END_POINT}/api/v1/a11y/search/autocomplete?q=taipei&lat=25.03&lng=121.56`,
      );
      return jsonResponse({
        ok: true,
        data: [suggestion],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await getPlaceAutocomplete({
      q: "taipei",
      lat: 25.03,
      lng: 121.56,
    });

    expect(res.ok).toBe(true);
    expect(res.data).toEqual([suggestion]);
  });

  it("calls search details endpoint with place ID", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain(
        `${END_POINT}/api/v1/a11y/search/details/osm%3Anode%3A123`,
      );
      return jsonResponse({
        ok: true,
        data: { id: "osm:node:123", name: "Taipei 101" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await getPlaceDetails("osm:node:123", {});
    expect(res.ok).toBe(true);
  });
});
