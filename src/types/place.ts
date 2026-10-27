// Types aligned with backend place-search contract (2026-07-27).

export type PlaceSource = "osm" | "google";

export interface PlaceGeoPoint {
  type: "Point";
  coordinates: [number, number]; // [lng, lat]
}

export interface AutocompleteItem {
  id: string;
  source: PlaceSource;
  primaryText: string;
  secondaryText: string | null;
  placeClass: string | null;
  placeType: string | null;
  typeLabel: string | null;
}

export interface NearbyFacilityBrief {
  displayName?: string;
  displayAddress?: string;
  id: string;
  name: string;
  address: string | null;
  category: string;
  typeLabel: string;
  distanceMeters: number;
}

export interface PlaceAccessibility {
  status: "accessible" | "limited" | "unknown";
  wheelchair: "yes" | "limited" | "no" | null;
  nearbyFacilityCount: number;
  source: "local-db" | "google" | "none";
}

export interface PlaceAddressComponents {
  road: string | null;
  district: string | null;
  city: string | null;
  postcode: string | null;
}

export interface PlaceReviewKey {
  placeId: string;
  placeType: "osm" | "a11y" | "bathroom" | "welfare" | "parking" | "google";
}

export interface PlaceResult {
  id: string;
  source: PlaceSource;
  name: string;
  fullAddress: string | null;
  addressComponents: PlaceAddressComponents;
  location: PlaceGeoPoint;
  placeClass: string | null;
  placeType: string | null;
  typeLabel: string | null;
  distanceMeters: number | null;
  rating: number | null;
  accessibility: PlaceAccessibility;
  nearbyFacilities: {
    toilets: NearbyFacilityBrief[];
    metro: NearbyFacilityBrief[];
  };
  // Reverse-geocoded and map-click places do not always have a stable review key.
  reviewKey: PlaceReviewKey | null;
  externalLinks: { osm: string | null; google: string | null };
  attribution: string | null;
}
