import type { SheetMode } from "@/stores/useMapStore";
import type { AiResultMarker, LatLng } from "@/types";
import type { AiIndoorRoutePlan, AiRoutePlan } from "@/types/route";

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

interface ShowIndoorRouteAction {
  type: "show-indoor-route";
  plan: AiIndoorRoutePlan;
}

// ── Panel ──

interface SwitchPanelAction {
  type: "switch-panel";
  sheet: SheetMode;
}

interface CloseChatAction {
  type: "close-chat";
}

/** The text assistant asks the page to start navigation, as the start button does. */
interface StartNavigationAction {
  type: "start-navigation";
  /** Omitted: the selected route. */
  routeId?: string;
}

interface StopNavigationAction {
  type: "stop-navigation";
}

// ── Union ──

export type UIAction =
  | ShowMarkersAction
  | ClearMarkersAction
  | FlyToAction
  | ShowRouteAction
  | ShowIndoorRouteAction
  | SwitchPanelAction
  | CloseChatAction
  | StartNavigationAction
  | StopNavigationAction;

export interface ActionResult {
  ok: boolean;
  skipped?: string;
  /** Resolves once an action that finishes later (starting navigation) has. */
  settled?: Promise<unknown>;
}
