import type { AccessibleRoute } from "@/types/route";

export type RoutePreviewQuery =
  | { planToken: string; sessionId?: never }
  | { sessionId: string; planToken?: never };

export interface RoutePreviewPageData {
  sessionId: string;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  originLabel: string;
  destinationLabel: string;
  travelMode?: string;
  routes: AccessibleRoute[];
}
