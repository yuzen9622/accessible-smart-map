import {
  Accessibility,
  AlertTriangle,
  Bookmark,
  Bus,
  CircleParking,
  Cloud,
  Heart,
  Search,
} from "lucide-react";
import type { RailPanel } from "@/stores/useMapStore";

export const SNAP_POINTS = {
  peek: 0.12,
  half: 0.38,
  full: 0.92,
};

// --- Rail icon definitions ---
export interface RailItem {
  id: RailPanel;
  Icon: React.ComponentType<{ className?: string }>;
  labelKey: string;
  color: string;
}

// §6.2 revision: "route" is dropped from the rail entirely (not even into
// "更多") — HomeContent already has its own "規劃路線" entry right below the
// search bar, so a second route-planning door on the rail duplicated that
// responsibility instead of adding one. Only the two lowest-frequency
// actions (hazard report, welfare directory) move into RAIL_MORE_ITEMS;
// everything else people reach for while looking at the map stays one tap
// away on the visible rail.
export const RAIL_ITEMS: RailItem[] = [
  { id: "search", Icon: Search, labelKey: "railSearch", color: "text-primary" },
  {
    id: "a11y",
    Icon: Accessibility,
    labelKey: "railA11y",
    color: "text-accessibility",
  },
  { id: "bus", Icon: Bus, labelKey: "railBus", color: "text-emerald-600" },
  {
    id: "parking",
    Icon: CircleParking,
    labelKey: "railParking",
    color: "text-indigo-500",
  },
  {
    id: "saved",
    Icon: Bookmark,
    labelKey: "savedPlaces",
    color: "text-amber-500",
  },
  {
    id: "environment",
    Icon: Cloud,
    labelKey: "environment",
    color: "text-sky-500",
  },
];

export const RAIL_MORE_ITEMS: RailItem[] = [
  {
    id: "hazard",
    Icon: AlertTriangle,
    labelKey: "reportHazard",
    color: "text-amber-500",
  },
  { id: "welfare", Icon: Heart, labelKey: "welfare", color: "text-rose-500" },
];

// --- Mode-driven panels: shown via sheetMode, override rail panels ---
export const MODE_PANELS = new Set([
  "place",
  "plan",
  "route",
  "navigation",
  "station",
]);

// Mode panels whose content component renders its own back/close + title
// header (PlaceContent, RoutePlanContent, RouteContent, StationDetailContent
// each have a "{/* Header */}" block at the top of their JSX) — the shared
// desktop chrome header below must stay hidden for these, exactly like the
// mobile header already does via its own sheetMode check, or the two stack
// into a visible double header. "navigation" is deliberately excluded:
// NavigationContent has no header of its own, so the shared chrome one is
// the only one and must stay.
export const MODE_PANELS_WITH_OWN_HEADER = new Set([
  "place",
  "plan",
  "route",
  "station",
]);

// Rail panels that render their own content component. "search" and "none"
// both fall through to HomeContent, so neither counts as "a sub-panel is
// showing". RailPanelOrHome reads the same set, so "is a panel open" can never
// disagree with what's actually rendered.
export const RAIL_CONTENT_PANELS = new Set<RailPanel>([
  "a11y",
  "bus",
  "parking",
  "saved",
  "environment",
  "hazard",
  "welfare",
]);
