"use client";

import { Navigation, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { shouldShowVoicePill } from "@/components/Voice/VoiceFloatingIndicator";
import { useAppTranslation } from "@/i18n/client";
import { fitRouteBounds, routeBoundsFromLegs } from "@/lib/mapCamera";
import { hasRouteSession, shouldShowRoutePill } from "@/lib/route/routeSession";
import { cn } from "@/lib/utils";
import useMapStore from "@/stores/useMapStore";
import useVoiceStore from "@/stores/useVoiceStore";

/**
 * The way back into a route the user planned and then navigated away from.
 *
 * Route geometry (the destination pin, the polyline) is drawn from store
 * fields that no panel owns, so before this existed the app kept them honest
 * by destroying the route whenever the user tapped anything else — which is
 * exactly why there was no way back to the route panel, and why a
 * destination pin that nobody remembered to clear could outlive its route.
 * Switching panels is now non-destructive and this pill is the session's
 * on-screen presence: tap it to return, ✕ to end it. Same shape as
 * `VoiceFloatingIndicator`, which solves the identical "the session is alive
 * but its panel isn't on screen" problem for voice.
 */
export default function RouteSessionPill() {
  const { t } = useAppTranslation();
  const {
    computeRoutes,
    selectRoute,
    destination,
    destinationName,
    sheetMode,
    isNavigating,
    resumeRouteSession,
    endRouteSession,
  } = useMapStore(
    useShallow((s) => ({
      computeRoutes: s.computeRoutes,
      selectRoute: s.selectRoute,
      destination: s.destination,
      destinationName: s.destinationName,
      sheetMode: s.sheetMode,
      isNavigating: s.isNavigating,
      resumeRouteSession: s.resumeRouteSession,
      endRouteSession: s.endRouteSession,
    })),
  );
  const voiceStatus = useVoiceStore((s) => s.status.status);
  const voiceViewMode = useVoiceStore((s) => s.viewMode);
  const chatOpen = useMapStore((s) => s.chatOpen);

  // Reopening the panel without moving the camera would leave the user
  // reading a route that isn't on screen — they may have panned anywhere
  // while they were off doing something else. Same recentering the app
  // already does when navigation ends. Store-level `resumeRouteSession`
  // can't do this itself: `mapCamera` imports the store.
  const handleResume = () => {
    resumeRouteSession();
    const { map } = useMapStore.getState();
    const legs = selectRoute?.route.legs;
    if (map && legs?.length) {
      fitRouteBounds(map, routeBoundsFromLegs(legs));
    }
  };

  const visible = shouldShowRoutePill({
    hasSession: hasRouteSession({ computeRoutes, selectRoute, destination }),
    sheetMode,
    isNavigating,
    chatOpen,
  });
  if (!visible) return null;

  // The voice pill owns the top-centre slot; stack below it rather than
  // fighting for the same coordinates (it can't be showing during navigation,
  // where it moves to the corner, because this pill is hidden there anyway).
  const voicePillShowing = shouldShowVoicePill(
    voiceStatus,
    chatOpen,
    voiceViewMode,
  );

  const label = destinationName?.trim()
    ? t("routeSessionPillTo", { destination: destinationName })
    : t("routeSessionPillGeneric");
  const minutes = selectRoute?.route.totalMinutes;

  return (
    <div
      // `inset-x-0` + centring flex rather than `left-1/2 -translate-x-1/2`:
      // the latter caps the pill's available width at half the viewport, which
      // on a phone truncated the destination down to "前往 臺…". The side
      // padding keeps it clear of the zoom controls in the top corners.
      className={cn(
        "fixed z-(--z-floating-controls) inset-x-0 px-14 flex justify-center pointer-events-none",
        voicePillShowing ? "top-16" : "top-3",
      )}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-card/95 backdrop-blur-sm border border-border/60 shadow-lg pl-3 pr-1.5 py-1.5 text-xs font-medium text-foreground">
        <button
          type="button"
          onClick={handleResume}
          className="flex items-center gap-2 min-h-11 min-w-11"
          aria-label={t("routeSessionPillResume")}
        >
          <Navigation className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="max-w-[45vw] truncate">{label}</span>
          {typeof minutes === "number" && (
            <span className="text-muted-foreground shrink-0">
              {t("minutesLeft", { count: Math.round(minutes) })}
            </span>
          )}
        </button>
        <Button
          type="button"
          onClick={endRouteSession}
          size="sm"
          variant="ghost"
          className="h-11 w-11 p-0 rounded-full shrink-0"
          aria-label={t("routeSessionPillEnd")}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
