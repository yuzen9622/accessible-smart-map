"use client";
import { create, type StateCreator } from "zustand";
import type { NavigationProgress } from "@/lib/navigation/navigationProgress";
import type { TransitGuide } from "@/lib/navigation/transitRide";
import {
  confirmBoarded,
  type TransitRideRuntime,
} from "@/lib/navigation/transitRideRuntime";
import type { VoiceTransitState } from "@/lib/voice/navTransit";
import type {
  VoiceNavAdvisory,
  VoiceRerouteReason,
} from "@/lib/voice/voiceSession";
import type { LatLng } from "@/types";
import type { NavInstruction } from "@/types/route";
import { withAtomicNotifications } from "./atomicNotifications";

export type NavAdvisory = VoiceNavAdvisory;
export type NavRerouteReason = VoiceRerouteReason;

export type HeadingSource = "compass" | "gps" | null;
export type CompassPermission = "unknown" | "granted" | "denied";
export type NavViewMode = "3d" | "2d";
export type NavigationSource = "local" | "voice";
export type RerouteStatus = "idle" | "pending" | "error";
export type EtaSource =
  | "schedule"
  | "realtime"
  | "free_flow"
  | "estimated"
  | "local"
  | null;

export interface NavProgressUpdate {
  remainingM?: number | null;
  remainingDurationSec?: number | null;
  estimatedArrivalAt?: number | null;
  etaSource?: EtaSource;
  distanceToNextM?: number | null;
}

/**
 * High-frequency turn-by-turn runtime state, kept OUT of useMapStore on
 * purpose: useMapStore is destructured wholesale by ClientMap and friends, so
 * writing heading/step there every GPS/compass tick would re-render the whole
 * map. Consumers here subscribe with selectors (useNavStore(s => s.field)).
 */
interface NavState {
  /** Which state machine owns step advancement for the active navigation. */
  navigationSource: NavigationSource;
  navigationMode: "preview" | "live";
  routeProgress: NavigationProgress | null;
  transitRide: TransitRideRuntime | null;
  transitGuide: TransitGuide | null;
  voiceTransit: VoiceTransitState | null;
  navigationId: string | null;
  routeVersion: number;
  instructions: NavInstruction[];
  warnings: string[];
  currentStepIndex: number;
  distanceToNextM: number | null;
  /** Combined heading shown by the marker / used to rotate the map. */
  userHeading: number | null;
  /** Raw course-over-ground from the geolocation watch (fallback source). */
  gpsHeading: number | null;
  headingSource: HeadingSource;
  isOffRoute: boolean;
  rerouteStatus: RerouteStatus;
  rerouteError: string | null;
  rerouteRetryable: boolean;
  /** 目前尚未關閉的主動警報，最新在前，上限 ADVISORY_MAX 則。 */
  advisories: NavAdvisory[];
  /** 最近一次改道的原因，供 HUD 顯示明確說明。 */
  lastRerouteReason: NavRerouteReason | null;
  arrived: boolean;
  compassPermission: CompassPermission;
  /** Preview step-change timestamp, retained for caller compatibility (not a live override). */
  lastManualTs: number;
  /** True after the user drags the map mid-navigation; camera-follow pauses. */
  followPaused: boolean;
  /** Meters left along the whole route (written by the engine). */
  remainingM: number | null;
  /** Seconds left along the whole route. */
  remainingDurationSec: number | null;
  /** Estimated arrival timestamp in epoch milliseconds. */
  estimatedArrivalAt: number | null;
  /** Whether the ETA came from the server or local engine. */
  etaSource: EtaSource;
  /** Timestamp of the most recent ETA write in epoch milliseconds. */
  etaUpdatedAt: number | null;
  /** Total route length in meters (set when instructions load). */
  routeTotalM: number | null;
  /** TTS announcements on step changes. */
  voiceEnabled: boolean;
  /** Step-list panel visibility while the nav HUD owns the screen. */
  stepListOpen: boolean;
  /** 2D or 3D view mode during navigation. */
  viewMode: NavViewMode;
  /** The upcoming step coordinate for preview camera moves. */
  stepCoord: LatLng | null;
}

interface NavAction {
  setRouteProgress: (progress: NavigationProgress | null) => void;
  promoteToLive: () => void;
  setTransitRide: (
    ride: TransitRideRuntime | null,
    guide: TransitGuide | null,
  ) => void;
  confirmBusBoarded: () => void;
  setNavigationSource: (source: NavigationSource) => void;
  setNavigationIdentity: (
    navigationId: string | null,
    routeVersion: number,
  ) => void;
  setInstructions: (
    instructions: NavInstruction[],
    warnings?: string[],
  ) => void;
  setCurrentStepIndex: (index: number) => void;
  applyVoiceStep: (
    index: number,
    instruction: string,
    remainingM: number | null,
  ) => void;
  /** Preview-only selection from prev/next or the step list. */
  setStepIndex: (index: number) => void;
  setDistanceToNextM: (m: number | null) => void;
  setUserHeading: (deg: number | null, source: HeadingSource) => void;
  setGpsHeading: (deg: number | null) => void;
  setIsOffRoute: (v: boolean) => void;
  setReroutePending: () => void;
  setRerouteIdle: () => void;
  setRerouteError: (message: string, retryable?: boolean) => void;
  pushAdvisories: (advisories: NavAdvisory[]) => void;
  dismissAdvisory: (advisoryId: string) => void;
  clearAdvisories: () => void;
  setLastRerouteReason: (reason: NavRerouteReason | null) => void;
  setArrived: (v: boolean) => void;
  setCompassPermission: (p: CompassPermission) => void;
  setFollowPaused: (v: boolean) => void;
  setRemainingM: (m: number | null) => void;
  setProgress: (update: NavProgressUpdate) => void;
  setRouteTotalM: (m: number | null) => void;
  setVoiceEnabled: (v: boolean) => void;
  setStepListOpen: (v: boolean) => void;
  setViewMode: (v: NavViewMode) => void;
  setStepCoord: (c: LatLng | null) => void;
  reset: () => void;
}

type NavStore = NavState & NavAction;

const ADVISORY_MAX = 3;

const initialState: NavState = {
  navigationSource: "local",
  navigationMode: "preview",
  routeProgress: null,
  transitRide: null,
  transitGuide: null,
  voiceTransit: null,
  navigationId: null,
  routeVersion: 0,
  instructions: [],
  warnings: [],
  currentStepIndex: 0,
  distanceToNextM: null,
  userHeading: null,
  gpsHeading: null,
  headingSource: null,
  isOffRoute: false,
  rerouteStatus: "idle",
  rerouteError: null,
  rerouteRetryable: false,
  advisories: [],
  lastRerouteReason: null,
  arrived: false,
  compassPermission: "unknown",
  lastManualTs: 0,
  followPaused: false,
  remainingM: null,
  remainingDurationSec: null,
  estimatedArrivalAt: null,
  etaSource: null,
  etaUpdatedAt: null,
  routeTotalM: null,
  voiceEnabled: false,
  stepListOpen: false,
  viewMode: "3d",
  stepCoord: null,
};

const navState: StateCreator<NavStore> = (set) => ({
  ...initialState,
  setRouteProgress: (routeProgress) => set({ routeProgress }),
  setNavigationSource: (navigationSource) =>
    set((state) =>
      state.navigationSource === navigationSource
        ? {}
        : {
            navigationSource,
            routeProgress: null,
            voiceTransit: null,
            navigationMode:
              navigationSource === "voice" || state.navigationSource === "voice"
                ? "live"
                : state.navigationMode,
            transitRide: null,
            transitGuide: null,
            lastManualTs: 0,
          },
    ),
  promoteToLive: () =>
    set((state) =>
      state.navigationSource === "local" && state.navigationMode === "preview"
        ? {
            navigationMode: "live",
            currentStepIndex: 0,
            lastManualTs: 0,
            stepListOpen: false,
            arrived: false,
            isOffRoute: false,
          }
        : {},
    ),
  setTransitRide: (transitRide, transitGuide) =>
    set({ transitRide, transitGuide }),
  confirmBusBoarded: () =>
    set((state) =>
      state.navigationSource === "local" &&
      state.navigationMode === "live" &&
      state.transitRide &&
      state.transitGuide?.phase === "waiting"
        ? { transitRide: confirmBoarded(state.transitRide, Date.now()) }
        : {},
    ),
  setNavigationIdentity: (navigationId, routeVersion) =>
    set((state) => ({
      navigationId,
      routeVersion,
      ...(state.navigationId !== navigationId ||
      state.routeVersion !== routeVersion
        ? {
            routeProgress: null,
            transitRide: null,
            transitGuide: null,
            voiceTransit: null,
            lastManualTs: 0,
            currentStepIndex: 0,
            arrived: false,
            isOffRoute: false,
            distanceToNextM: null,
            remainingM: null,
          }
        : {}),
    })),
  setInstructions: (instructions, warnings = []) =>
    set({
      instructions,
      warnings,
      routeProgress: null,
      voiceTransit: null,
      transitRide: null,
      transitGuide: null,
      lastManualTs: 0,
      currentStepIndex: 0,
      arrived: false,
      isOffRoute: false,
      rerouteStatus: "idle",
      rerouteError: null,
      rerouteRetryable: false,
      advisories: [],
      lastRerouteReason: null,
      remainingDurationSec: null,
      estimatedArrivalAt: null,
      etaSource: null,
      etaUpdatedAt: null,
    }),
  setCurrentStepIndex: (currentStepIndex) => set({ currentStepIndex }),
  applyVoiceStep: (currentStepIndex, instruction, remainingM) =>
    set((state) => ({
      instructions: state.instructions.map((step, index) =>
        index === currentStepIndex ? { ...step, text: instruction } : step,
      ),
      currentStepIndex,
      voiceTransit:
        state.instructions[currentStepIndex]?.type === "transit_alight" ||
        ["WALK", "DRIVE", "MOTORCYCLE"].includes(
          state.instructions[currentStepIndex]?.legType,
        )
          ? null
          : state.voiceTransit,
      distanceToNextM: remainingM,
      remainingM,
      isOffRoute: false,
    })),
  setStepIndex: (index) =>
    set((state) =>
      state.navigationSource === "local" &&
      state.navigationMode === "preview" &&
      Number.isInteger(index)
        ? {
            currentStepIndex: Math.max(
              0,
              Math.min(index, state.instructions.length - 1),
            ),
            lastManualTs: Date.now(),
          }
        : {},
    ),
  setDistanceToNextM: (distanceToNextM) => set({ distanceToNextM }),
  setUserHeading: (userHeading, headingSource) =>
    set({ userHeading, headingSource }),
  setGpsHeading: (gpsHeading) => set({ gpsHeading }),
  setIsOffRoute: (isOffRoute) => set({ isOffRoute }),
  setReroutePending: () =>
    set({
      rerouteStatus: "pending",
      rerouteError: null,
      rerouteRetryable: false,
    }),
  setRerouteIdle: () =>
    set({
      rerouteStatus: "idle",
      rerouteError: null,
      rerouteRetryable: false,
    }),
  setRerouteError: (rerouteError, rerouteRetryable = true) =>
    set({ rerouteStatus: "error", rerouteError, rerouteRetryable }),
  pushAdvisories: (incoming) =>
    set((state) => {
      const byId = new Map(state.advisories.map((a) => [a.advisoryId, a]));
      for (const a of incoming) byId.set(a.advisoryId, a);
      return {
        advisories: [...byId.values()]
          .sort((l, r) => r.issuedAt.localeCompare(l.issuedAt))
          .slice(0, ADVISORY_MAX),
      };
    }),
  dismissAdvisory: (advisoryId) =>
    set((state) => ({
      advisories: state.advisories.filter((a) => a.advisoryId !== advisoryId),
    })),
  clearAdvisories: () => set({ advisories: [] }),
  setLastRerouteReason: (lastRerouteReason) => set({ lastRerouteReason }),
  setArrived: (arrived) =>
    set(() => ({
      arrived,
      ...(arrived
        ? {
            advisories: [],
            voiceTransit: null,
            remainingM: 0,
            distanceToNextM: 0,
            remainingDurationSec: 0,
            estimatedArrivalAt: null,
            etaSource: null,
            etaUpdatedAt: null,
          }
        : {}),
    })),
  setCompassPermission: (compassPermission) => set({ compassPermission }),
  setFollowPaused: (followPaused) => set({ followPaused }),
  setRemainingM: (remainingM) => set({ remainingM }),
  setProgress: (update) =>
    set(() => {
      const progress: Partial<NavState> = {};
      if ("remainingM" in update && update.remainingM !== undefined)
        progress.remainingM = update.remainingM;
      if (
        "remainingDurationSec" in update &&
        update.remainingDurationSec !== undefined
      )
        progress.remainingDurationSec = update.remainingDurationSec;
      if (
        "estimatedArrivalAt" in update &&
        update.estimatedArrivalAt !== undefined
      )
        progress.estimatedArrivalAt = update.estimatedArrivalAt;
      if ("etaSource" in update && update.etaSource !== undefined)
        progress.etaSource = update.etaSource;
      if ("distanceToNextM" in update && update.distanceToNextM !== undefined)
        progress.distanceToNextM = update.distanceToNextM;
      if (
        ("remainingDurationSec" in update &&
          update.remainingDurationSec !== undefined) ||
        ("estimatedArrivalAt" in update &&
          update.estimatedArrivalAt !== undefined)
      ) {
        progress.etaUpdatedAt = Date.now();
      }
      return progress;
    }),
  setRouteTotalM: (routeTotalM) => set({ routeTotalM }),
  setVoiceEnabled: (voiceEnabled) => set({ voiceEnabled }),
  setStepListOpen: (stepListOpen) => set({ stepListOpen }),
  setViewMode: (viewMode) => set({ viewMode }),
  setStepCoord: (stepCoord) => set({ stepCoord }),
  // Keep the iOS compass-permission grant across navigation sessions.
  reset: () =>
    set((s) => ({
      ...initialState,
      compassPermission: s.compassPermission,
    })),
});

const useNavStore = create<NavStore>(withAtomicNotifications(navState));
export default useNavStore;
