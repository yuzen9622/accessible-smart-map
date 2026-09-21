"use client";
import {
  Accessibility,
  AlertTriangle,
  Bookmark,
  Bus,
  CircleParking,
  Cloud,
  Heart,
  Navigation,
  Search,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useAppTranslation } from "@/i18n/client";
import useMapStore from "@/stores/useMapStore";
import {
  A11yPanel,
  BusPanel,
  EnvironmentPanel,
  HazardReportPanel,
  NavigationContent,
  ParkingPanel,
  PlaceContent,
  RouteContent,
  RoutePlanContent,
  SavedPlacesPanel,
  StationDetailContent,
  WelfarePanel,
} from "./panelRegistry";
import { MODE_PANELS } from "./railConfig";

// --- Panel title based on active panel ---
export function PanelTitle() {
  const { t } = useAppTranslation();
  const { sheetMode, activeRailPanel } = useMapStore(
    useShallow((s) => ({
      sheetMode: s.sheetMode,
      activeRailPanel: s.activeRailPanel,
    })),
  );

  const modePanelActive = MODE_PANELS.has(sheetMode);
  if (modePanelActive) {
    switch (sheetMode) {
      case "place":
        return <>{t("title")}</>;
      case "plan":
        return (
          <>
            <Navigation className="h-4 w-4 text-blue-500" /> {t("planRoute")}
          </>
        );
      case "route":
        return (
          <>
            <Navigation className="h-4 w-4 text-blue-500" /> {t("route")}
          </>
        );
      case "navigation":
        return (
          <>
            <Navigation className="h-4 w-4 text-blue-500" />{" "}
            {t("navInstructions")}
          </>
        );
      case "station":
        return (
          <>
            <Accessibility className="h-4 w-4 text-accessibility" />{" "}
            {t("stationDetail")}
          </>
        );
    }
  }

  switch (activeRailPanel) {
    case "search":
      return (
        <>
          <Search className="h-4 w-4 text-primary" /> {t("railSearch")}
        </>
      );
    case "a11y":
      return (
        <>
          <Accessibility className="h-4 w-4 text-accessibility" />{" "}
          {t("accessibleTitle")}
        </>
      );
    case "bus":
      return (
        <>
          <Bus className="h-4 w-4 text-emerald-600" /> {t("busInfo")}
        </>
      );
    case "parking":
      return (
        <>
          <CircleParking className="h-4 w-4 text-indigo-500" /> {t("parking")}
        </>
      );
    case "saved":
      return (
        <>
          <Bookmark className="h-4 w-4 text-amber-500" /> {t("savedPlaces")}
        </>
      );
    case "environment":
      return (
        <>
          <Cloud className="h-4 w-4 text-sky-500" /> {t("environment")}
        </>
      );
    case "hazard":
      return (
        <>
          <AlertTriangle className="h-4 w-4 text-amber-500" />{" "}
          {t("reportHazard")}
        </>
      );
    case "welfare":
      return (
        <>
          <Heart className="h-4 w-4 text-rose-500" /> {t("welfare")}
        </>
      );
    default:
      return <>{t("title")}</>;
  }
}

// --- Single source of truth for "which rail panel is showing" — shared by
// both desktop and mobile so a quick-action click has exactly one code path
// to render through, instead of desktop reading this switch while mobile
// fell back to HomeContent's own local subPanel copy of the same logic. ---
export function RailPanelOrHome({
  onHomeSlotRef,
}: {
  onHomeSlotRef: (el: HTMLDivElement | null) => void;
}) {
  const { activeRailPanel, setActiveRailPanel } = useMapStore(
    useShallow((s) => ({
      activeRailPanel: s.activeRailPanel,
      setActiveRailPanel: s.setActiveRailPanel,
    })),
  );
  // Back out to the search home view, matching the header's back button —
  // "none" would close the whole panel on desktop and merely re-render the
  // same HomeContent on mobile.
  const closePanel = () => setActiveRailPanel("search");

  switch (activeRailPanel) {
    case "a11y":
      return <A11yPanel onClose={closePanel} hideHeader />;
    case "bus":
      return <BusPanel onClose={closePanel} hideHeader />;
    case "parking":
      return <ParkingPanel onClose={closePanel} hideHeader />;
    case "saved":
      return <SavedPlacesPanel onClose={closePanel} hideHeader />;
    case "environment":
      return <EnvironmentPanel onClose={closePanel} hideHeader />;
    case "hazard":
      return <HazardReportPanel onClose={closePanel} hideHeader />;
    case "welfare":
      return <WelfarePanel onClose={closePanel} hideHeader />;
    // "search" and "none" are the home view itself — both mean "no
    // sub-panel". Keep this list in sync with RAIL_CONTENT_PANELS. This marker
    // div is a portal *target*, not `HomeContent` itself — see the single real
    // mount in `BottomSheet`.
    default:
      return <div ref={onHomeSlotRef} className="contents" />;
  }
}

// --- Desktop panel content switcher ---
export function DesktopPanelContent({
  onHomeSlotRef,
}: {
  onHomeSlotRef: (el: HTMLDivElement | null) => void;
}) {
  const { sheetMode } = useMapStore(
    useShallow((s) => ({ sheetMode: s.sheetMode })),
  );

  const modePanelActive = MODE_PANELS.has(sheetMode);
  if (modePanelActive) {
    switch (sheetMode) {
      case "place":
        return <PlaceContent />;
      case "plan":
        return <RoutePlanContent />;
      case "route":
        return <RouteContent />;
      case "navigation":
        return <NavigationContent />;
      case "station":
        return <StationDetailContent />;
    }
  }

  return <RailPanelOrHome onHomeSlotRef={onHomeSlotRef} />;
}

// --- Mobile sheet content ---
export function MobileSheetContent({
  onHomeSlotRef,
}: {
  onHomeSlotRef: (el: HTMLDivElement | null) => void;
}) {
  const { sheetMode } = useMapStore(
    useShallow((s) => ({ sheetMode: s.sheetMode })),
  );
  switch (sheetMode) {
    case "home":
      return <RailPanelOrHome onHomeSlotRef={onHomeSlotRef} />;
    case "place":
      return <PlaceContent />;
    case "plan":
      return <RoutePlanContent />;
    case "route":
      return <RouteContent />;
    case "navigation":
      return <NavigationContent />;
    case "station":
      return <StationDetailContent />;
    default:
      return <RailPanelOrHome onHomeSlotRef={onHomeSlotRef} />;
  }
}
