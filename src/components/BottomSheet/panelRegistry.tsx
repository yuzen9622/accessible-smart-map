"use client";
import dynamic from "next/dynamic";
import {
  A11yPanelSkeleton,
  BusPanelSkeleton,
  ChatSkeleton,
  EnvironmentSkeleton,
  HazardReportSkeleton,
  NavigationSkeleton,
  ParkingPanelSkeleton,
  PlaceSkeleton,
  RouteContentSkeleton,
  RoutePlanSkeleton,
  SavedPlacesSkeleton,
  StationDetailSkeleton,
  WelfareSkeleton,
} from "./PanelSkeletons";

export const AIChatBot = dynamic(() => import("@/components/AIChatBot"), {
  loading: () => <ChatSkeleton />,
  ssr: false,
});
export const ExitNavDialog = dynamic(
  () => import("@/components/Navigation/ExitNavDialog"),
  { ssr: false },
);
export const A11yPanel = dynamic(() => import("./A11yPanel"), {
  loading: () => <A11yPanelSkeleton />,
  ssr: false,
});
export const BusPanel = dynamic(() => import("./BusPanel"), {
  loading: () => <BusPanelSkeleton />,
  ssr: false,
});
export const EnvironmentPanel = dynamic(() => import("./EnvironmentPanel"), {
  loading: () => <EnvironmentSkeleton />,
  ssr: false,
});
export const HazardReportPanel = dynamic(() => import("./HazardReportPanel"), {
  loading: () => <HazardReportSkeleton />,
  ssr: false,
});
export const ParkingPanel = dynamic(() => import("./ParkingPanel"), {
  loading: () => <ParkingPanelSkeleton />,
  ssr: false,
});
export const SavedPlacesPanel = dynamic(() => import("./SavedPlacesPanel"), {
  loading: () => <SavedPlacesSkeleton />,
  ssr: false,
});
export const WelfarePanel = dynamic(() => import("./WelfarePanel"), {
  loading: () => <WelfareSkeleton />,
  ssr: false,
});
export const PlaceContent = dynamic(() => import("./PlaceContent"), {
  loading: () => <PlaceSkeleton />,
  ssr: false,
});
export const RoutePlanContent = dynamic(() => import("./RoutePlanContent"), {
  loading: () => <RoutePlanSkeleton />,
  ssr: false,
});
export const RouteContent = dynamic(() => import("./RouteContent"), {
  loading: () => <RouteContentSkeleton />,
  ssr: false,
});
export const NavigationContent = dynamic(() => import("./NavigationContent"), {
  loading: () => <NavigationSkeleton />,
  ssr: false,
});
export const StationDetailContent = dynamic(
  () => import("./StationDetailContent"),
  {
    loading: () => <StationDetailSkeleton />,
    ssr: false,
  },
);

export const MyReportsPanel = dynamic(() => import("./MyReportsPanel"), {
  loading: () => <HazardReportSkeleton />,
  ssr: false,
});
