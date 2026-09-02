"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import useVoiceSession from "@/hook/useVoiceSession";
import { haversineMeters } from "@/lib/geo";
import { handleVoiceRerouteEvent } from "@/lib/navigation/rerouteCoordinator";
import { toNavProgressUpdate } from "@/lib/voice/navProgress";
import type { VoiceNavigationEvent } from "@/lib/voice/voiceSession";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import useVoiceStore from "@/stores/useVoiceStore";
import type { NavInstruction } from "@/types/route";
import VoiceFloatingIndicator from "./VoiceFloatingIndicator";

function routeTokenFromMap(): string | null {
  const token = useMapStore.getState().selectRoute?.route.routeToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

function toNavInstruction(
  step: Extract<VoiceNavigationEvent, { type: "nav.start" }>["steps"][number],
): NavInstruction {
  return {
    text: step.instruction,
    type: step.isTransit
      ? "transit_board"
      : step.index === 0
        ? "depart"
        : "turn",
    bearing: null,
    relativeDirection: null,
    distanceM: step.distanceM,
    streetName: null,
    legType: step.legType,
    polylineIndex: null,
  };
}

/**
 * Persistent voice-session owner (plan §4/§5.1, rev16). Exactly one
 * instance exists for the whole page (mounted in `ClientMap.tsx` next to
 * `AIChatBot`) and is never unmounted by the chat panel opening/closing —
 * that's the point of the background-execution model: the session (and
 * its recording indicator) must keep running while `AIChatBot` is
 * unmounted (`AIChatBot` returns `null`, and unmounts, whenever the panel
 * is closed or navigation starts).
 *
 * It owns the only `useVoiceSession()` instance, mirrors its state into
 * `useVoiceStore` so two independently-mounted subtrees (`VoiceModeView`
 * inside `AIChatBot`, and this component's own `VoiceFloatingIndicator`)
 * can both read it, binds the store's start/end/resumePlayback actions to
 * the real controller, and bridges backend-owned `nav.*` events into the
 * existing map/navigation stores.
 */
export default function VoiceSessionHost() {
  const {
    status,
    transcripts,
    activeTool,
    navigationEvents,
    startSession,
    endSession,
    resumePlayback,
    setNavigationRoute,
    sendNavigationPosition,
    cancelNavigation,
    consumeNavigationEvents,
  } = useVoiceSession();
  const lastSentPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const serverStoppedNavigationRef = useRef(false);

  useEffect(() => {
    useVoiceStore.getState().bindSessionActions({
      start: startSession,
      end: endSession,
      resumePlayback,
    });
  }, [startSession, endSession, resumePlayback]);

  useEffect(() => {
    useVoiceStore.getState().setStatus(status);
    if (
      status.status === "reconnecting" ||
      status.status === "ended" ||
      status.status === "needs-login" ||
      status.status === "error"
    ) {
      const nav = useNavStore.getState();
      const map = useMapStore.getState();
      if (nav.navigationSource === "voice" && map.isNavigating) {
        // A rebuilt Live session has no navigation-session resumption. Exit
        // the stale HUD; session.ready will re-arm the route so the user can
        // ask to start navigation again.
        nav.setNavigationSource("local");
        serverStoppedNavigationRef.current = true;
        map.setIsNavigating(false);
      }
    }
  }, [status]);

  useEffect(() => {
    useVoiceStore.getState().setTranscripts(transcripts);
  }, [transcripts]);

  useEffect(() => {
    useVoiceStore.getState().setActiveTool(activeTool);
  }, [activeTool]);

  // Keep the selected HTTP route armed. The controller queues the latest
  // token until session.ready and re-sends it after a 1006/4410 reconnect.
  useEffect(() => {
    setNavigationRoute(routeTokenFromMap());
    const unsubscribe = useMapStore.subscribe((state, previous) => {
      if (
        state.selectRoute?.route.routeToken !==
        previous.selectRoute?.route.routeToken
      ) {
        setNavigationRoute(routeTokenFromMap());
      }
    });
    return unsubscribe;
  }, [setNavigationRoute]);

  // Forward throttled map fixes while the backend voice-navigation state
  // machine owns navigation. The existing geolocation watch remains the
  // single browser location source; transit legs intentionally keep sending.
  useEffect(() => {
    const unsubscribe = useMapStore.subscribe((state, previous) => {
      const location = state.userLocation;
      if (!location || location === previous.userLocation) return;
      const nav = useNavStore.getState();
      if (
        !state.isNavigating ||
        nav.navigationSource !== "voice" ||
        nav.arrived
      ) {
        return;
      }

      const last = lastSentPositionRef.current;
      if (last && haversineMeters(last, location) < 10) return;
      lastSentPositionRef.current = location;
      const heading = nav.userHeading ?? nav.gpsHeading;
      sendNavigationPosition({
        latitude: location.lat,
        longitude: location.lng,
        ...(heading == null ? {} : { heading }),
      });
    });
    return unsubscribe;
  }, [sendNavigationPosition]);

  // Any UI path that leaves a backend-owned navigation emits nav.cancel.
  // Server-originated nav.stop changes the source first, so it is not echoed.
  useEffect(() => {
    const unsubscribe = useMapStore.subscribe((state, previous) => {
      if (previous.isNavigating && !state.isNavigating) {
        const nav = useNavStore.getState();
        if (
          nav.navigationSource === "voice" &&
          !serverStoppedNavigationRef.current
        ) {
          cancelNavigation();
        }
        nav.setNavigationSource("local");
        lastSentPositionRef.current = null;
        serverStoppedNavigationRef.current = false;
      }
    });
    return unsubscribe;
  }, [cancelNavigation]);

  useEffect(() => {
    if (navigationEvents.length === 0) return;
    const canApplyNavigationEvent =
      status.status === "ready" ||
      status.status === "listening" ||
      status.status === "model-speaking" ||
      status.status === "playback-blocked";
    if (!canApplyNavigationEvent) {
      consumeNavigationEvents(navigationEvents.length);
      return;
    }

    for (const navigationEvent of navigationEvents) {
      const map = useMapStore.getState();
      const nav = useNavStore.getState();

      switch (navigationEvent.type) {
        case "nav.start": {
          const instructions = navigationEvent.steps.map(toNavInstruction);
          const totalM = navigationEvent.steps.reduce(
            (sum, step) => sum + (step.distanceM ?? 0),
            0,
          );
          nav.setNavigationSource("voice");
          nav.setNavigationIdentity(
            map.selectRoute?.route.navigationId ?? null,
            map.selectRoute?.route.routeVersion ?? 0,
          );
          nav.setInstructions(instructions);
          nav.setCurrentStepIndex(navigationEvent.currentStepIndex);
          nav.setDistanceToNextM(
            navigationEvent.steps[navigationEvent.currentStepIndex]
              ?.distanceM ?? null,
          );
          nav.setRouteTotalM(totalM || null);
          nav.setRemainingM(totalM || null);
          nav.setVoiceEnabled(false);
          lastSentPositionRef.current = null;
          serverStoppedNavigationRef.current = false;
          map.setIsNavigating(true);
          if (map.userLocation) {
            const heading = nav.userHeading ?? nav.gpsHeading;
            lastSentPositionRef.current = map.userLocation;
            sendNavigationPosition({
              latitude: map.userLocation.lat,
              longitude: map.userLocation.lng,
              ...(heading == null ? {} : { heading }),
            });
          }
          break;
        }
        case "nav.step":
          nav.applyVoiceStep(
            navigationEvent.currentStepIndex,
            navigationEvent.instruction,
            navigationEvent.remainingM,
          );
          break;
        case "nav.progress": {
          const currentNavigationId =
            map.selectRoute?.route.navigationId ?? nav.navigationId;
          const currentRouteVersion =
            map.selectRoute?.route.routeVersion ?? nav.routeVersion;
          if (
            nav.navigationSource === "voice" &&
            !nav.arrived &&
            currentNavigationId !== null &&
            navigationEvent.navigationId === currentNavigationId &&
            navigationEvent.routeVersion === currentRouteVersion
          ) {
            nav.setProgress(toNavProgressUpdate(navigationEvent));
          }
          break;
        }
        case "nav.transit": {
          const nextTransit = nav.instructions.findIndex(
            (step, index) =>
              index >= nav.currentStepIndex &&
              step.legType === navigationEvent.leg.mode,
          );
          if (nextTransit >= 0) nav.setCurrentStepIndex(nextTransit);
          nav.setDistanceToNextM(null);
          break;
        }
        case "nav.offroute":
          nav.setIsOffRoute(true);
          break;
        case "nav.rerouting":
          handleVoiceRerouteEvent({
            type: "nav.rerouting",
            navigationId: navigationEvent.navigationId,
            previousRouteVersion: navigationEvent.previousRouteVersion,
          });
          break;
        case "nav.route_replaced": {
          const instructions = navigationEvent.instructions
            ? navigationEvent.instructions
            : navigationEvent.steps.map(toNavInstruction);
          handleVoiceRerouteEvent({
            type: "nav.route_replaced",
            replacement: {
              navigationId: navigationEvent.navigationId,
              previousRouteVersion: navigationEvent.previousRouteVersion,
              routeVersion: navigationEvent.routeVersion,
              routeToken: navigationEvent.routeToken,
              route: navigationEvent.route,
              instructions,
              warnings: navigationEvent.warnings,
              currentStepIndex: navigationEvent.currentStepIndex,
            },
          });
          break;
        }
        case "nav.reroute_failed":
          handleVoiceRerouteEvent({
            type: "nav.reroute_failed",
            navigationId: navigationEvent.navigationId,
            previousRouteVersion: navigationEvent.previousRouteVersion,
            message: navigationEvent.message,
            retryable: navigationEvent.retryable,
          });
          break;
        case "nav.arrived":
          nav.setArrived(true);
          break;
        case "nav.stop":
          lastSentPositionRef.current = null;
          if (navigationEvent.reason === "arrived") {
            serverStoppedNavigationRef.current = true;
            nav.setArrived(true);
          } else if (map.isNavigating) {
            nav.setNavigationSource("local");
            map.setIsNavigating(false);
          }
          break;
        case "nav.error":
          nav.setNavigationSource("local");
          if (map.isNavigating) map.setIsNavigating(false);
          toast.error(navigationEvent.message);
          break;
      }
    }
    consumeNavigationEvents(navigationEvents.length);
  }, [
    navigationEvents,
    status.status,
    consumeNavigationEvents,
    sendNavigationPosition,
  ]);

  // Leaving the map page (this host unmounting) is a terminal path too.
  useEffect(() => {
    return () => endSession();
  }, [endSession]);

  return <VoiceFloatingIndicator />;
}
