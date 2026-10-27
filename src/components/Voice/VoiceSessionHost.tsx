"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import useVoiceSession from "@/hook/useVoiceSession";
import { useAppTranslation } from "@/i18n/client";
import { haversineMeters } from "@/lib/geo";
import { localRerouteCoordinator } from "@/lib/navigation/localRerouteCoordinator";
import {
  startNavigation,
  stopNavigation,
} from "@/lib/navigation/navigationLifecycle";
import { handleVoiceRerouteEvent } from "@/lib/navigation/rerouteCoordinator";
import { toNavProgressUpdate } from "@/lib/voice/navProgress";
import { resumedTransit } from "@/lib/voice/navTransit";
import { handleNavigationExit } from "@/lib/voice/voiceNavigationExit";
import {
  shouldAcceptAdvisoryEvent,
  type VoiceNavigationEvent,
} from "@/lib/voice/voiceSession";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import useVoiceStore from "@/stores/useVoiceStore";
import type { NavInstruction } from "@/types/route";
import VoiceFloatingIndicator from "./VoiceFloatingIndicator";

function routeTokenFromMap(): string | null {
  const map = useMapStore.getState();
  const token = (map.activeNavigationRoute ?? map.selectRoute?.route)
    ?.routeToken;
  if (map.busSelection?.routeToken === token) return null;
  return typeof token === "string" && token.length > 0 ? token : null;
}

function toNavInstruction(
  step: Extract<VoiceNavigationEvent, { type: "nav.start" }>["steps"][number],
): NavInstruction {
  return {
    text: step.instruction,
    type:
      (step.type as NavInstruction["type"]) ??
      (step.isTransit ? "transit_board" : step.index === 0 ? "depart" : "turn"),
    bearing: step.bearing ?? null,
    relativeDirection:
      (step.relativeDirection as NavInstruction["relativeDirection"]) ?? null,
    distanceM: step.distanceM,
    streetName: step.streetName ?? null,
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
  const { t } = useAppTranslation();
  const {
    status,
    transcripts,
    activeTool,
    toolActivities,
    navigationEvents,
    startSession,
    endSession,
    resumePlayback,
    setNavigationRoute,
    sendNavigationPosition,
    cancelNavigation,
    consumeNavigationEvents,
    setMuted,
  } = useVoiceSession();
  const lastSentPositionRef = useRef<{ lat: number; lng: number } | null>(null);
  const serverStoppedNavigationRef = useRef(false);
  const rejectedStartRef = useRef(false);

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
    // "reconnecting" is deliberately NOT terminal (WP4): the controller sends
    // nav.resume once the rebuilt session is ready, so the HUD must survive
    // the gap instead of being torn down and losing the navigation.
    if (navigationEvents.length > 0) return; // consume accepted FIFO events before terminal takeover
    if (
      status.status === "ended" ||
      status.status === "needs-login" ||
      status.status === "error"
    ) {
      const nav = useNavStore.getState();
      const map = useMapStore.getState();
      if (nav.navigationSource === "voice" && map.isNavigating) {
        // Losing the voice transport must not end the navigation: hand
        // turn-by-turn back to the local engine (the same takeover the
        // nav.resume_failed branch performs) so the HUD and its alerts live on.
        nav.setNavigationSource("local");
        lastSentPositionRef.current = null;
        serverStoppedNavigationRef.current = false;
        if (status.code !== "assistant-end")
          toast.info(t("voiceAssistantLostNavContinues"));
      }
    }
  }, [status, navigationEvents.length, t]);

  useEffect(() => {
    useVoiceStore.getState().setTranscripts(transcripts);
  }, [transcripts]);

  useEffect(() => {
    useVoiceStore.getState().setActiveTool(activeTool);
  }, [activeTool]);

  useEffect(() => {
    useVoiceStore.getState().setToolActivities(toolActivities);
  }, [toolActivities]);

  // Keep the selected HTTP route armed. The controller queues the latest
  // token until session.ready and re-sends it after a 1006/4410 reconnect.
  useEffect(() => {
    const syncRoute = () => {
      const map = useMapStore.getState();
      const token = routeTokenFromMap();
      setNavigationRoute(token);
      // Clearing the controller token alone does not cancel a server-side start.
      if (!token && map.busSelection && !map.isNavigating) {
        rejectedStartRef.current = true;
        cancelNavigation();
      }
    };
    syncRoute();
    const unsubscribe = useMapStore.subscribe((state, previous) => {
      if (
        state.activeNavigationRoute !== previous.activeNavigationRoute ||
        state.selectRoute?.route.routeToken !==
          previous.selectRoute?.route.routeToken ||
        state.busSelection !== previous.busSelection
      ) {
        if (
          !state.isNavigating ||
          state.activeNavigationRoute !== previous.activeNavigationRoute
        )
          syncRoute();
      }
    });
    return unsubscribe;
  }, [setNavigationRoute, cancelNavigation]);

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

  // Returning to the foreground: whatever fix arrives next must reach the
  // server even if the device barely moved, because the backend's last known
  // position is as old as the time spent backgrounded (WP4).
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

  // Leaving a navigation (from any path) cancels a backend-owned session and
  // releases the mute; the rule itself lives in `handleNavigationExit`.
  useEffect(() => {
    const unsubscribe = useMapStore.subscribe((state, previous) => {
      if (previous.isNavigating && !state.isNavigating) {
        const nav = useNavStore.getState();
        handleNavigationExit(
          {
            navigationSource: nav.navigationSource,
            serverStopped: serverStoppedNavigationRef.current,
          },
          {
            cancelNavigation,
            setNavigationSource: nav.setNavigationSource,
            setMuted: useVoiceStore.getState().setMuted,
          },
        );
        lastSentPositionRef.current = null;
        serverStoppedNavigationRef.current = false;
      }
    });
    return unsubscribe;
  }, [cancelNavigation]);

  useEffect(() => {
    if (navigationEvents.length === 0) return;
    // Already gated at receipt using the controller's synchronous status.
    // A subsequent close in the same React batch must not discard accepted replay.
    for (const navigationEvent of navigationEvents) {
      const map = useMapStore.getState();
      const nav = useNavStore.getState();
      if (
        rejectedStartRef.current &&
        navigationEvent.type !== "nav.start" &&
        navigationEvent.type !== "nav.resume_ok"
      )
        continue;

      switch (navigationEvent.type) {
        case "nav.start": {
          if (
            (map.busSelection &&
              map.busSelection.routeToken ===
                map.selectRoute?.route.routeToken) ||
            (navigationEvent.selectionGeneration !== undefined &&
              navigationEvent.selectionGeneration !== map.routeGeneration)
          ) {
            rejectedStartRef.current = true;
            cancelNavigation();
            break;
          }
          const candidate = navigationEvent.armedRouteToken
            ? [
                map.activeNavigationRoute,
                ...(map.computeRoutes ?? []),
                map.selectRoute?.route,
              ].find(
                (route) =>
                  route?.routeToken === navigationEvent.armedRouteToken,
              )
            : (map.computeRoutes?.[0] ?? map.selectRoute?.route);
          if (
            !candidate?.routeToken ||
            map.invalidRouteTokens.includes(candidate.routeToken)
          ) {
            rejectedStartRef.current = true;
            cancelNavigation();
            break;
          }
          rejectedStartRef.current = false;
          // Preserve backend order, independently of any manual preview selection.
          const candidateIndex = Math.max(
            0,
            map.computeRoutes?.indexOf(candidate) ?? 0,
          );
          useMapStore.setState({
            selectRoute: { index: candidateIndex, route: candidate },
            selectedRouteId: candidate.routeId,
            ...(map.selectRoute?.route !== candidate
              ? { routeGeneration: map.routeGeneration + 1 }
              : {}),
          });
          const instructions = navigationEvent.steps.map(toNavInstruction);
          const totalM = navigationEvent.steps.reduce(
            (sum, step) => sum + (step.distanceM ?? 0),
            0,
          );
          nav.setNavigationSource("voice");
          nav.setNavigationIdentity(
            candidate.navigationId ?? null,
            candidate.routeVersion ?? 0,
          );
          nav.setInstructions(instructions, candidate.warnings ?? []);
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
          startNavigation();
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
            (map.activeNavigationRoute ?? map.selectRoute?.route)
              ?.navigationId ?? nav.navigationId;
          const currentRouteVersion =
            (map.activeNavigationRoute ?? map.selectRoute?.route)
              ?.routeVersion ?? nav.routeVersion;
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
          if (
            !map.isNavigating ||
            nav.navigationSource !== "voice" ||
            nav.arrived
          )
            break;
          useNavStore.setState({
            voiceTransit: { leg: navigationEvent.leg, onVehicle: true },
          });
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
            reason: navigationEvent.reason,
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
              warningDetails: navigationEvent.warningDetails,
              currentStepIndex: navigationEvent.currentStepIndex,
              reason: navigationEvent.reason,
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
        case "nav.resume_ok": {
          if (
            !map.isNavigating ||
            nav.arrived ||
            !nav.navigationId ||
            navigationEvent.navigationId !== nav.navigationId ||
            navigationEvent.routeVersion !== nav.routeVersion ||
            navigationEvent.routeToken !== map.activeNavigationRoute?.routeToken
          ) {
            break;
          }
          // The backend still owns this navigation: hand step advancement
          // back to it and adopt its authoritative progress snapshot.
          rejectedStartRef.current = false;
          nav.setNavigationSource("voice");
          // resume acknowledges this route, it does not replace its warnings/reason/advisories.
          useNavStore.setState({
            ...(navigationEvent.steps.length > 0
              ? { instructions: navigationEvent.steps.map(toNavInstruction) }
              : {}),
            currentStepIndex: navigationEvent.currentStepIndex,
            voiceTransit: resumedTransit(
              map.activeNavigationRoute,
              navigationEvent.steps,
              navigationEvent.currentStepIndex,
              navigationEvent.onVehicle,
            ),
            distanceToNextM: null,
            remainingM: null,
            remainingDurationSec: null,
            estimatedArrivalAt: null,
            etaSource: null,
            etaUpdatedAt: null,
          });
          if (map.userLocation)
            sendNavigationPosition({
              latitude: map.userLocation.lat,
              longitude: map.userLocation.lng,
            });
          serverStoppedNavigationRef.current = false;
          // Nothing was forwarded while the socket was down; let the next fix
          // through regardless of how far the user moved.
          lastSentPositionRef.current = null;
          break;
        }
        case "nav.resume_failed": {
          if (
            !map.isNavigating ||
            nav.arrived ||
            navigationEvent.navigationId !== nav.navigationId
          )
            break;
          // Keep the HUD on screen: the local engine takes over turn-by-turn
          // immediately, and a reroute from the current position rebuilds a
          // route the backend no longer holds.
          nav.setNavigationSource("local");
          lastSentPositionRef.current = null;
          serverStoppedNavigationRef.current = false;
          toast.info(t("voiceReconnectedRerouting"));
          if (map.userLocation) {
            void localRerouteCoordinator.triggerAutoReroute(map.userLocation);
          }
          break;
        }
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
            stopNavigation();
          }
          break;
        case "nav.error":
          nav.setNavigationSource("local");
          if (map.isNavigating) stopNavigation();
          toast.error(navigationEvent.message);
          break;
      }
    }
    consumeNavigationEvents(navigationEvents.length);
  }, [
    navigationEvents,
    consumeNavigationEvents,
    sendNavigationPosition,
    cancelNavigation,
    t,
  ]);

  // Leaving the map page (this host unmounting) is a terminal path too.
  useEffect(() => {
    return () => endSession();
  }, [endSession]);

  return <VoiceFloatingIndicator />;
}
