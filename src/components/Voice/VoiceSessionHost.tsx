"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import useVoiceSession from "@/hook/useVoiceSession";
import { haversineMeters } from "@/lib/geo";
import { setNavigationCueSink } from "@/lib/navigation/navigationAudio";
import { handleVoiceRerouteEvent } from "@/lib/navigation/rerouteCoordinator";
import {
  busWaitOf,
  currentNavigationState,
  setVoiceCueSink,
} from "@/lib/voice/voiceNavigationControl";
import {
  isVoiceSpeechChannelLive,
  shouldAcceptAdvisoryEvent,
} from "@/lib/voice/voiceSession";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import useVoiceStore from "@/stores/useVoiceStore";
import VoiceFloatingIndicator from "./VoiceFloatingIndicator";

/** Distance-only state updates are throttled; step, mode and start/end changes are sent at once. */
const STATE_MIN_INTERVAL_MS = 5_000;

function navigatedRouteToken(): string | null {
  const token = useMapStore.getState().activeNavigationRoute?.routeToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

/**
 * Persistent voice-session owner (plan §4/§5.1, rev16). Exactly one
 * instance exists for the whole page (mounted in `ClientMap.tsx` next to
 * `AIChatBot`) and is never unmounted by the chat panel opening/closing —
 * that's the point of the background-execution model: the session (and
 * its recording indicator) must keep running while `AIChatBot` is
 * unmounted.
 *
 * Navigation has one engine, the page's own. The assistant starts, stops
 * and advances it through `ui.command` (the same functions as the buttons,
 * see `voiceNavigationControl`); this host reports the engine's state, hands
 * its announcements to the assistant as `nav.cue`, and lets the backend
 * follow the navigated route only to raise corridor alerts.
 */
export default function VoiceSessionHost() {
  const {
    status,
    transcripts,
    activeTool,
    toolActivities,
    navigationEvents,
    startSession,
    endSession,
    resumePlayback,
    sendNavigationPosition,
    cancelNavigation,
    startNavigationTracking,
    sendNavigationState,
    sendNavigationCue,
    onSessionReady,
    consumeNavigationEvents,
    setMuted,
  } = useVoiceSession();
  const lastSentPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastStateSentAtRef = useRef(0);
  const statusRef = useRef(status);
  statusRef.current = status;

  useEffect(() => {
    useVoiceStore.getState().bindSessionActions({
      start: startSession,
      end: endSession,
      resumePlayback,
      setMuted,
    });
  }, [startSession, endSession, resumePlayback, setMuted]);

  useEffect(() => {
    useVoiceStore.getState().setStatus(status);
  }, [status]);

  useEffect(() => {
    useVoiceStore.getState().setTranscripts(transcripts);
  }, [transcripts]);

  useEffect(() => {
    useVoiceStore.getState().setActiveTool(activeTool);
  }, [activeTool]);

  useEffect(() => {
    useVoiceStore.getState().setToolActivities(toolActivities);
  }, [toolActivities]);

  useEffect(() => {
    const live = () => isVoiceSpeechChannelLive(statusRef.current.status);
    const position = () => {
      const map = useMapStore.getState();
      const nav = useNavStore.getState();
      const heading = nav.userHeading ?? nav.gpsHeading;
      return map.userLocation
        ? {
            latitude: map.userLocation.lat,
            longitude: map.userLocation.lng,
            ...(heading == null ? {} : { heading }),
          }
        : undefined;
    };
    const publishState = (force: boolean) => {
      if (!live()) return;
      const now = Date.now();
      if (!force && now - lastStateSentAtRef.current < STATE_MIN_INTERVAL_MS)
        return;
      lastStateSentAtRef.current = now;
      sendNavigationState(currentNavigationState());
    };
    const trackNavigation = () => {
      const token = navigatedRouteToken();
      if (!token || !live()) return;
      lastSentPositionRef.current = useMapStore.getState().userLocation;
      startNavigationTracking(token, position());
    };

    // Engine announcements go to the assistant while it can speak them.
    // Muted assistant: the line is swallowed, never doubled on local TTS.
    setNavigationCueSink((text) => {
      if (!live()) return false;
      if (!useVoiceStore.getState().isMuted) sendNavigationCue(text);
      return true;
    });
    setVoiceCueSink(sendNavigationCue);
    onSessionReady(() => {
      lastSentPositionRef.current = null;
      if (useMapStore.getState().isNavigating) trackNavigation();
      publishState(true);
    });

    const offMap = useMapStore.subscribe((state, previous) => {
      if (state.isNavigating && !previous.isNavigating) trackNavigation();
      else if (
        state.isNavigating &&
        state.activeNavigationRoute?.routeToken !==
          previous.activeNavigationRoute?.routeToken
      )
        trackNavigation();
      if (previous.isNavigating && !state.isNavigating) {
        if (live()) cancelNavigation();
        lastSentPositionRef.current = null;
      }
      if (
        state.isNavigating !== previous.isNavigating ||
        state.venueJourney?.guidance !== previous.venueJourney?.guidance
      )
        publishState(true);

      const location = state.userLocation;
      if (!location || location === previous.userLocation || !live()) return;
      const last = lastSentPositionRef.current;
      if (last && haversineMeters(last, location) < 10) return;
      lastSentPositionRef.current = location;
      const fix = position();
      if (fix) sendNavigationPosition(fix);
    });
    const offNav = useNavStore.subscribe((state, previous) => {
      const changed =
        state.currentStepIndex !== previous.currentStepIndex ||
        state.navigationMode !== previous.navigationMode ||
        state.arrived !== previous.arrived ||
        state.instructions !== previous.instructions ||
        // The waiting card's minutes or expected time changed: the assistant
        // must answer from what the screen shows. The guide object is rebuilt
        // on every GPS sample, so compare what is sent, not the reference.
        JSON.stringify(busWaitOf(state.transitGuide)) !==
          JSON.stringify(busWaitOf(previous.transitGuide));
      if (changed) publishState(true);
      else if (state.distanceToNextM !== previous.distanceToNextM)
        publishState(false);
    });
    return () => {
      offMap();
      offNav();
      setNavigationCueSink(null);
      setVoiceCueSink(null);
      onSessionReady(null);
    };
  }, [
    cancelNavigation,
    onSessionReady,
    sendNavigationCue,
    sendNavigationPosition,
    sendNavigationState,
    startNavigationTracking,
  ]);

  // Returning to the foreground: the next fix must reach the server even if
  // the device barely moved, since its last position is as old as the gap.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      lastSentPositionRef.current = null;
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  // The backend only sends corridor alerts and the reroutes they cause; both
  // apply to the page's own navigation through the shared reroute seam.
  useEffect(() => {
    if (navigationEvents.length === 0) return;
    for (const navigationEvent of navigationEvents) {
      const map = useMapStore.getState();
      const nav = useNavStore.getState();
      switch (navigationEvent.type) {
        case "nav.rerouting":
          handleVoiceRerouteEvent({
            type: "nav.rerouting",
            navigationId: navigationEvent.navigationId,
            previousRouteVersion: navigationEvent.previousRouteVersion,
            reason: navigationEvent.reason,
          });
          break;
        case "nav.route_replaced":
          handleVoiceRerouteEvent({
            type: "nav.route_replaced",
            replacement: {
              navigationId: navigationEvent.navigationId,
              previousRouteVersion: navigationEvent.previousRouteVersion,
              routeVersion: navigationEvent.routeVersion,
              routeToken: navigationEvent.routeToken,
              route: navigationEvent.route,
              instructions: navigationEvent.instructions ?? [],
              warnings: navigationEvent.warnings,
              warningDetails: navigationEvent.warningDetails,
              currentStepIndex: navigationEvent.currentStepIndex,
              reason: navigationEvent.reason,
            },
          });
          break;
        case "nav.reroute_failed":
          handleVoiceRerouteEvent({
            type: "nav.reroute_failed",
            navigationId: navigationEvent.navigationId,
            previousRouteVersion: navigationEvent.previousRouteVersion,
            message: navigationEvent.message,
            retryable: navigationEvent.retryable,
          });
          break;
        case "nav.advisory": {
          const accepted = shouldAcceptAdvisoryEvent(navigationEvent, {
            isNavigating: map.isNavigating,
            arrived: nav.arrived,
            navigationId:
              (map.activeNavigationRoute ?? map.selectRoute?.route)
                ?.navigationId ?? nav.navigationId,
            routeVersion:
              (map.activeNavigationRoute ?? map.selectRoute?.route)
                ?.routeVersion ?? nav.routeVersion,
          });
          if (!accepted) break;
          nav.pushAdvisories(navigationEvent.advisories);
          const critical = navigationEvent.advisories.find(
            (a) => a.severity === "critical",
          );
          if (critical) toast.warning(critical.title);
          break;
        }
      }
    }
    consumeNavigationEvents(navigationEvents.length);
  }, [navigationEvents, consumeNavigationEvents]);

  // Leaving the map page (this host unmounting) is a terminal path too.
  useEffect(() => {
    return () => endSession();
  }, [endSession]);

  return <VoiceFloatingIndicator />;
}
