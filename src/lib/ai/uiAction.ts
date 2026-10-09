import type { SheetMode } from "@/stores/useMapStore";
import type { AiResultMarker, LatLng } from "@/types";
import type { AiRoutePlan } from "@/types/route";

// ── Map ──

interface ShowMarkersAction {
  type: "show-markers";
  markers: AiResultMarker[];
}

interface ClearMarkersAction {
  type: "clear-markers";
}

interface FlyToAction {
  type: "fly-to";
  position: LatLng;
  zoom?: number;
}

// ── Route ──

interface ShowRouteAction {
  type: "show-route";
  plan: AiRoutePlan;
}

// ── Panel ──

interface SwitchPanelAction {
  type: "switch-panel";
  sheet: SheetMode;
}

interface CloseChatAction {
  type: "close-chat";
}

// ── Union ──

export type UIAction =
  | ShowMarkersAction
  | ClearMarkersAction
  | FlyToAction
  | ShowRouteAction
  | SwitchPanelAction
  | CloseChatAction;

export interface ActionResult {
  ok: boolean;
  skipped?: string;
}
