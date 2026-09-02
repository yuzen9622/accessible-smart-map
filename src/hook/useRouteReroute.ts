"use client";

import { useCallback, useEffect, useRef } from "react";
import { rerouteAccessibleRoute } from "@/lib/api/a11y";
import { ApiError } from "@/lib/fetch";
import {
  applyRouteReplacement,
  normalizeRerouteReplacement,
} from "@/lib/navigation/rerouteCoordinator";
import useMapStore from "@/stores/useMapStore";
import useNavStore, { type NavigationSource } from "@/stores/useNavStore";
import type { LatLng } from "@/types";
import type { ApiResponse } from "@/types/response";
import type {
  AccessibleRouteRerouteData,
  AccessibleRouteRerouteRequest,
  RerouteReason,
} from "@/types/route";

export const REROUTE_COOLDOWN_MS = 30_000;

interface LocalRerouteContext {
  navigationSource: NavigationSource;
  navigationId: string | null;
  routeToken: string | null;
  routeVersion: number;
  position: LatLng | null;
}

interface LocalRerouteControllerDeps {
  readContext: () => LocalRerouteContext;
  post: (
    request: AccessibleRouteRerouteRequest,
  ) => Promise<ApiResponse<AccessibleRouteRerouteData>>;
  apply: (data: AccessibleRouteRerouteData) => boolean;
  setPending: () => void;
  setError: (message: string) => void;
  now?: () => number;
  createRequestId?: () => string;
}

/** Local-only request gate. Voice mode exits before the HTTP seam. */
export class LocalRerouteController {
  private episodeActive = false;
  private automaticRequested = false;
  private inFlight = false;
  private lastAutomaticRequestAt = Number.NEGATIVE_INFINITY;
  private currentEpisodeRequestId: string | null = null;
  private episodeGeneration = 0;
  private readonly now: () => number;
  private readonly createRequestId: () => string;

  constructor(private readonly deps: LocalRerouteControllerDeps) {
    this.now = deps.now ?? Date.now;
    this.createRequestId =
      deps.createRequestId ?? (() => globalThis.crypto.randomUUID());
  }

  confirmOffRouteEpisode(position?: LatLng): Promise<boolean> {
    if (!this.episodeActive) {
      this.episodeActive = true;
      this.automaticRequested = false;
      this.currentEpisodeRequestId = this.createRequestId();
      this.episodeGeneration++;
    }
    if (this.automaticRequested) return Promise.resolve(false);
    if (this.now() - this.lastAutomaticRequestAt < REROUTE_COOLDOWN_MS) {
      return Promise.resolve(false);
    }
    this.automaticRequested = true;
    this.lastAutomaticRequestAt = this.now();
    return this.request("OFF_ROUTE", position);
  }

  clearOffRouteEpisode(): void {
    this.episodeActive = false;
    this.automaticRequested = false;
    this.currentEpisodeRequestId = null;
    this.episodeGeneration++;
  }

  retry(position?: LatLng): Promise<boolean> {
    if (!this.episodeActive) return Promise.resolve(false);
    if (!this.currentEpisodeRequestId) {
      this.currentEpisodeRequestId = this.createRequestId();
    }
    return this.request("MANUAL", position);
  }

  private async request(
    reason: RerouteReason,
    positionOverride?: LatLng,
  ): Promise<boolean> {
    const requestGeneration = this.episodeGeneration;
    const requestId = this.currentEpisodeRequestId ?? this.createRequestId();
    const context = this.deps.readContext();
    if (context.navigationSource !== "local" || this.inFlight) return false;
    const position = positionOverride ?? context.position;
    if (
      !context.navigationId ||
      !context.routeToken ||
      context.routeVersion < 1 ||
      !position
    ) {
      this.deps.setError("無法重新規劃路線，請稍後重試");
      return false;
    }

    this.inFlight = true;
    if (!this.isCurrentRequest(context, requestGeneration)) {
      this.inFlight = false;
      return false;
    }
    this.deps.setPending();
    try {
      const response = await this.deps.post({
        routeToken: context.routeToken,
        currentPosition: {
          latitude: position.lat,
          longitude: position.lng,
        },
        previousRouteVersion: context.routeVersion,
        reason,
        clientRequestId: requestId,
      });
      if (!this.isCurrentRequest(context, requestGeneration)) return false;
      const succeeded = response.ok === true || response.success === true;
      if (!succeeded || !response.data) {
        this.deps.setError(response.message || "無法重新規劃路線");
        return false;
      }
      const applied = this.deps.apply(response.data);
      if (applied) this.clearOffRouteEpisode();
      return applied;
    } catch (error) {
      if (!this.isCurrentRequest(context, requestGeneration)) return false;
      this.deps.setError(
        error instanceof ApiError || error instanceof Error
          ? error.message
          : "網路連線失敗，請稍後重試",
      );
      return false;
    } finally {
      this.inFlight = false;
    }
  }

  private isCurrentRequest(
    expected: LocalRerouteContext,
    requestGeneration?: number,
  ): boolean {
    if (
      requestGeneration !== undefined &&
      (!this.episodeActive || this.episodeGeneration !== requestGeneration)
    ) {
      return false;
    }
    const current = this.deps.readContext();
    return (
      current.navigationSource === "local" &&
      current.navigationId === expected.navigationId &&
      current.routeVersion === expected.routeVersion &&
      current.routeToken === expected.routeToken
    );
  }
}

function readContext(): LocalRerouteContext {
  const map = useMapStore.getState();
  const nav = useNavStore.getState();
  const route = map.selectRoute?.route;
  const routeNavigationId = route?.navigationId ?? null;
  const routeVersion = route?.routeVersion ?? 0;
  const hasMatchingRuntimeIdentity =
    routeNavigationId !== null &&
    nav.navigationId === routeNavigationId &&
    nav.routeVersion === routeVersion;
  return {
    navigationSource: nav.navigationSource,
    navigationId: hasMatchingRuntimeIdentity ? routeNavigationId : null,
    routeToken:
      typeof route?.routeToken === "string" && route.routeToken.length > 0
        ? route.routeToken
        : null,
    routeVersion: hasMatchingRuntimeIdentity ? routeVersion : 0,
    position: map.userLocation,
  };
}

/** Binds the local off-route episode detector to the frozen reroute endpoint. */
export default function useRouteReroute() {
  const retryNonce = useNavStore((state) => state.rerouteRetryNonce);
  const controllerRef = useRef<LocalRerouteController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new LocalRerouteController({
      readContext,
      post: rerouteAccessibleRoute,
      apply: (data) => applyRouteReplacement(normalizeRerouteReplacement(data)),
      setPending: () => useNavStore.getState().setReroutePending(),
      setError: (message) => useNavStore.getState().setRerouteError(message),
    });
  }

  const retryNonceRef = useRef(retryNonce);
  useEffect(() => {
    if (retryNonce === retryNonceRef.current) return;
    retryNonceRef.current = retryNonce;
    void controllerRef.current?.retry();
  }, [retryNonce]);

  useEffect(() => {
    return () => {
      controllerRef.current?.clearOffRouteEpisode();
    };
  }, []);

  const confirmOffRouteEpisode = useCallback((position: LatLng) => {
    void controllerRef.current?.confirmOffRouteEpisode(position);
  }, []);
  const clearOffRouteEpisode = useCallback(() => {
    controllerRef.current?.clearOffRouteEpisode();
  }, []);

  return { confirmOffRouteEpisode, clearOffRouteEpisode };
}
