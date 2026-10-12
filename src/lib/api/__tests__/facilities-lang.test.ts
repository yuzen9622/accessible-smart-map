import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getAllA11yFacilities,
  getNearbyParking,
  getNearbyRouteA11yPlaces,
  getNearbyWelfare,
  getOsmPlaceDetail,
} from "../a11y";

const h = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/fetch", () => ({ fetchRequest: h.fetch }));
afterEach(() => vi.clearAllMocks());

describe("facility GET language (route POST untouched)", () => {
  const signal = new AbortController().signal;
  const calls = [
    (lang?: string) => getAllA11yFacilities(lang),
    (lang?: string) =>
      getNearbyRouteA11yPlaces({ lat: 25, lng: 121 }, signal, lang),
    (lang?: string) => getOsmPlaceDetail("123", signal, lang),
    (lang?: string) => getNearbyWelfare(25, 121, 3000, lang),
    (lang?: string) => getNearbyParking(25, 121, lang),
  ];
  it.each(calls.map((call, index) => ({ call, index })))(
    "omits lang for legacy caller $index and adds optional lang",
    async ({ call, index }) => {
      h.fetch.mockResolvedValue({ ok: true, data: [] });
      await call();
      expect(new URL(h.fetch.mock.calls[0][0]).searchParams.has("lang")).toBe(
        false,
      );
      await call("en");
      const query = new URL(h.fetch.mock.calls[1][0]).searchParams;
      expect(query.get("lang")).toBe("en");
      if (index === 1 || index === 2)
        expect(h.fetch.mock.calls[1][1].signal).toBe(signal);
      if (index === 0)
        expect(query.get("category")).toBe("elevator,ramp,toilet");
      if (index === 2) expect(query.get("osmId")).toBe("123");
      if (index === 3) expect(query.get("radius")).toBe("3000");
    },
  );
});
