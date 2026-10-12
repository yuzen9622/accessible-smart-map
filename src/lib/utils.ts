import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { nonemptyName } from "@/lib/route/sourceNames";
import {
  A11yEnum,
  type IBathroom,
  type Marker,
  type metroA11yData,
} from "@/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * The a11y datasets used to ship flat coordinate fields (經度/緯度 or
 * latitude/longitude) but newer backend payloads only carry a GeoJSON
 * `location.coordinates` [lng, lat]. Accept both shapes.
 */
export function geoCoords(
  location: { coordinates?: unknown } | null | undefined,
  legacyLat?: number | string,
  legacyLng?: number | string,
): { lat: number; lng: number } | null {
  const finite = (lat: unknown, lng: unknown) => {
    const la = parseFloat(String(lat));
    const ln = parseFloat(String(lng));
    return Number.isFinite(la) && Number.isFinite(ln)
      ? { lat: la, lng: ln }
      : null;
  };
  const c = location?.coordinates;
  if (Array.isArray(c) && c.length >= 2) {
    const fromGeo = finite(c[1], c[0]);
    if (fromGeo) return fromGeo;
  }
  return finite(legacyLat, legacyLng);
}

export function formatMetroA11y(places: metroA11yData[]) {
  return places.flatMap((place) => {
    const { _id, osmId, 經度, 緯度 } = place;
    const position = geoCoords(place.location, 緯度, 經度);
    if (!position) return [];
    const name = place["出入口電梯/無障礙坡道名稱"] ?? "";
    const a11yType = name.includes("電梯") ? A11yEnum.ELEVATOR : A11yEnum.RAMP;

    return {
      id: _id ?? osmId,
      canonicalTitle: name,
      position,
      type: "pin",
      content: {
        title: nonemptyName(place.displayName) || name,
        desc: place.出入口編號 ?? "",
      },
      zIndex: 1,
      a11yType,
    };
  }) as Marker[];
}

export function formatBathroom(bathrooms: IBathroom[]) {
  return bathrooms.flatMap((bathroom) => {
    const { _id, latitude, longitude, name, diaper } = bathroom;
    const position = geoCoords(bathroom.location, latitude, longitude);
    if (!position) return [];

    return {
      id: _id,
      canonicalTitle: name,
      position,
      type: "pin",
      content: {
        title: nonemptyName(bathroom.displayName) || name,
        desc: diaper ? "有提供尿布台" : "無提供尿布台",
      },
      zIndex: 1,
      a11yType: A11yEnum.RESTROOM,
    };
  }) as Marker[];
}

/**
 * Formats a NominatimPlace object to have a clean name (地名) and display_name (完整地址).
 * It updates name and display_name properties directly on the object.
 */
export function formatNominatimPlace<
  T extends {
    name?: string;
    display_name: string;
    address?: Record<string, string>;
  },
>(place: T, language: string = "zh-TW"): T {
  if (!place) return place;

  const addr = place.address;
  const isTaiwan =
    language === "zh-TW" ||
    addr?.country_code === "tw" ||
    addr?.country === "臺灣" ||
    addr?.country === "Taiwan";

  // 1. Determine a clean name (地名)
  let cleanName = "";
  if (addr) {
    // Look for common POI name keys that are not part of general address
    const poiKeys = [
      "railway",
      "amenity",
      "shop",
      "tourism",
      "historic",
      "leisure",
      "building",
      "office",
      "craft",
      "place",
      "aeroway",
      "club",
      "natural",
      "emergency",
      "highway",
    ];
    for (const key of poiKeys) {
      if (addr[key] && typeof addr[key] === "string") {
        cleanName = addr[key];
        break;
      }
    }
  }

  if (!cleanName) {
    cleanName = place.name || place.display_name.split(",")[0]?.trim() || "";
  }

  // 2. Format a clean address (完整地址)
  let cleanAddress = "";
  if (addr) {
    if (isTaiwan) {
      // Taiwan address structure: [縣市][鄉鎮市區][村里/聚落][路街段][號]
      const county = addr.county || addr.city || addr.state || "";
      const town =
        addr.town || addr.district || addr.city_district || addr.suburb || "";

      const village = addr.village || "";
      const hamlet = addr.hamlet || "";

      let locInfo = village;
      if (hamlet && hamlet !== locInfo) {
        locInfo += locInfo ? ` (${hamlet})` : hamlet;
      }

      const road = addr.road || addr.pedestrian || "";
      const houseNumber = addr.house_number
        ? `${addr.house_number}`.endsWith("號")
          ? addr.house_number
          : `${addr.house_number}號`
        : "";

      // Combine parts in order: county -> town -> locInfo -> road -> houseNumber
      const parts = [];
      if (county && county !== addr.country) parts.push(county);
      if (town && town !== county) parts.push(town);
      if (locInfo) parts.push(locInfo);
      if (road) parts.push(road);
      if (houseNumber) parts.push(houseNumber);

      cleanAddress = parts.join("");
    } else {
      // International address: clean up zip codes, ISO codes, and POI name duplicates
      const excludeKeys = [
        "country_code",
        "postcode",
        "ISO3166-2-lvl4",
        "ISO3166-2-lvl3",
        "ISO3166-2-lvl2",
      ];
      const addressParts = Object.entries(addr)
        .filter(([key, val]) => {
          if (excludeKeys.includes(key) || !val || typeof val !== "string")
            return false;
          if (val === cleanName) return false;
          return true;
        })
        .map(([_, val]) => val);

      cleanAddress = addressParts.join(", ");
    }
  }

  // Fallback to parsed display_name if address formatting didn't yield anything
  if (!cleanAddress) {
    const rawParts = place.display_name.split(",").map((p) => p.trim());
    const isPostalCode = (str: string) => /^\d{3,6}$/.test(str);
    const isIsoCode = (str: string) =>
      /^[A-Z]{2}-[A-Z0-9]+$/.test(str) || str.startsWith("ISO");

    const filteredParts = rawParts.filter((part) => {
      if (isPostalCode(part) || isIsoCode(part)) return false;
      if (part === cleanName) return false;
      return true;
    });

    if (isTaiwan) {
      cleanAddress = filteredParts.reverse().join("");
    } else {
      cleanAddress = filteredParts.join(", ");
    }
  }

  // Assign formatted values
  place.name = cleanName;
  place.display_name = cleanAddress;

  return place;
}
