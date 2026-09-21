"use client";

import {
  AlertTriangle,
  Check,
  HelpCircle,
  Loader2,
  Locate,
  MapPin,
  Navigation,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Marker } from "react-map-gl/maplibre";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import useComputeRoute from "@/hook/useComputeRoute";
import { useAppTranslation } from "@/i18n/client";
import { getPublicSosSession } from "@/lib/api/sos";
import { ApiError } from "@/lib/fetch";
import useMapStore from "@/stores/useMapStore";
import type { SosPublicSession, SosType } from "@/types/sos";

const POLL_MS = 10000;

type Phase =
  | "none"
  | "loading"
  | "active"
  | "resolved"
  | "not_found"
  | "expired"
  | "error";

const SOS_TYPE_LABEL_KEY: Record<SosType, string> = {
  body: "sosBodyDiscomfort",
  trapped: "sosTrapped",
  share_location: "sosShareLocationType",
};

const SOS_TYPE_ICON: Record<SosType, typeof AlertTriangle> = {
  body: AlertTriangle,
  trapped: HelpCircle,
  share_location: MapPin,
};

export default function SosTrackerWrapper() {
  const { t, i18n } = useAppTranslation();
  const {
    map,
    userLocation,
    setSheetMode,
    setDestinationName,
    setSosNavActive,
    setRouteSubPanel,
  } = useMapStore(
    useShallow((s) => ({
      map: s.map,
      userLocation: s.userLocation,
      setSheetMode: s.setSheetMode,
      setDestinationName: s.setDestinationName,
      setSosNavActive: s.setSosNavActive,
      setRouteSubPanel: s.setRouteSubPanel,
    })),
  );
  const { handleComputeRoute } = useComputeRoute();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [session, setSession] = useState<SosPublicSession | null>(null);
  const [phase, setPhase] = useState<Phase>("none");
  const [hasCentered, setHasCentered] = useState(false);
  const [showResolvedDialog, setShowResolvedDialog] = useState(false);
  const [resolvedMessage, setResolvedMessage] = useState("");

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Parse sessionId from URL query param
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const sos = urlParams.get("sos");
      if (sos) {
        setSessionId(sos);
        setPhase("loading");
      }
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const cleanUrl = useCallback(() => {
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("sos");
      window.history.replaceState({}, "", url.pathname + url.search);
    }
  }, []);

  const handleResolveState = useCallback(
    (messageKey: string) => {
      stopPolling();
      setResolvedMessage(t(messageKey));
      setShowResolvedDialog(true);
      setPhase("resolved");
      setSession(null);
      setSosNavActive(false);
      cleanUrl();
    },
    [t, stopPolling, cleanUrl, setSosNavActive],
  );

  useEffect(() => {
    if (!sessionId) return;

    const tick = async () => {
      try {
        const res = await getPublicSosSession(sessionId);
        if (!res.data) return;

        setSession(res.data);

        if (res.data.status === "resolved") {
          handleResolveState("sosTrackingResolved");
        } else {
          setPhase("active");
        }
      } catch (err) {
        if (err instanceof ApiError) {
          if (err.code === 404) {
            handleResolveState("sosTrackingNotFound");
            return;
          }
          if (err.code === 410) {
            handleResolveState("sosTrackingExpired");
            return;
          }
        }
        setPhase((prev) => {
          if (prev === "loading") return "error";
          return prev;
        });
      }
    };

    tick();
    pollTimer.current = setInterval(tick, POLL_MS);

    return () => {
      stopPolling();
    };
  }, [sessionId, handleResolveState, stopPolling]);

  // Centering behavior (fly to the tracked location on first successful load)
  useEffect(() => {
    if (!map || !session || hasCentered) return;
    setHasCentered(true);
    map.flyTo({
      center: [session.lng, session.lat],
      zoom: 17,
      duration: 1200,
    });
  }, [map, session, hasCentered]);

  const centerOnRequester = useCallback(() => {
    if (!map || !session) return;
    map.flyTo({
      center: [session.lng, session.lat],
      zoom: 17,
      duration: 800,
    });
  }, [map, session]);

  // One-tap navigation to the (live) requester. Emergency default: drive.
  // Origin falls back to the helper's userLocation inside useComputeRoute.
  const handleNavigate = useCallback(async () => {
    if (!session) return;
    if (!userLocation) {
      toast.error(t("sosTrackingNoLocation"));
      return;
    }
    setSosNavActive(true);
    setDestinationName(session.address ?? t("sosTrackingRequesterLabel"));
    // Same reset as RoutePlanContent: a fresh route starts on the plain
    // route list, not on a sub-page left over from a previous one.
    setRouteSubPanel("none");
    setSheetMode("route");
    const ok = await handleComputeRoute({
      destination: { lat: session.lat, lng: session.lng },
      travelMode: "drive",
    });
    if (!ok) setSosNavActive(false);
  }, [
    session,
    userLocation,
    t,
    setSosNavActive,
    setDestinationName,
    setRouteSubPanel,
    setSheetMode,
    handleComputeRoute,
  ]);

  const handleCloseTracker = useCallback(() => {
    stopPolling();
    setSessionId(null);
    setSession(null);
    setPhase("none");
    setSosNavActive(false);
    cleanUrl();
    toast.success(t("sosClose"));
  }, [stopPolling, cleanUrl, t, setSosNavActive]);

  if (phase === "none") return null;

  const Icon = session ? SOS_TYPE_ICON[session.type] : AlertTriangle;
  const lang = i18n.language === "zh-TW" ? "zh-TW" : "en";
  const updatedAtLabel = session
    ? new Date(session.updatedAt).toLocaleString(lang)
    : "";

  return (
    <>
      {/* Loading Overlay */}
      {phase === "loading" && (
        <div className="absolute inset-0 bg-background/40 backdrop-blur-xs flex items-center justify-center z-40 pointer-events-auto">
          <div className="bg-background/90 border border-border shadow-xl rounded-2xl p-5 flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-red-500" />
            <p className="text-sm font-semibold">{t("locating")}</p>
          </div>
        </div>
      )}

      {/* Error state widget */}
      {phase === "error" && !session && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 w-full max-w-sm px-4 pointer-events-auto">
          <div className="bg-background/90 backdrop-blur-md border border-red-500/30 rounded-2xl shadow-xl p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="h-9 w-9 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-red-500">
                {t("sosTrackingError")}
              </p>
            </div>
            <button
              type="button"
              onClick={handleCloseTracker}
              className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* SOS Marker on Map */}
      {session && (
        <Marker
          longitude={session.lng}
          latitude={session.lat}
          anchor="bottom"
          onClick={(e) => {
            e.originalEvent.stopPropagation();
            centerOnRequester();
          }}
        >
          <div className="relative flex items-center justify-center h-12 w-12 cursor-pointer">
            <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-60 animate-ping" />
            <span className="absolute inline-flex h-[80%] w-[80%] rounded-full bg-red-500 opacity-40 animate-pulse" />
            <div className="relative h-9 w-9 rounded-full bg-red-600 border-2 border-white shadow-xl flex items-center justify-center text-white transition-transform hover:scale-110">
              <Icon className="h-4.5 w-4.5" />
            </div>
          </div>
        </Marker>
      )}

      {/* Floating Tracking Card */}
      {session && (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: -20, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: -20, x: "-50%" }}
            className="absolute top-4 left-1/2 z-30 w-full max-w-sm px-4 pointer-events-auto"
          >
            <div className="bg-background/90 backdrop-blur-md border border-border/80 rounded-2xl shadow-xl p-4 flex flex-col gap-3">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-border/40 pb-2">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                  </span>
                  <span className="text-sm font-bold text-red-500">
                    {t("sosTrackingTitle")}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleCloseTracker}
                  className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted"
                  aria-label="Close tracking"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Body */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-7 w-7 rounded-full bg-red-500/10 flex items-center justify-center text-red-600">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm font-semibold">
                    {t(SOS_TYPE_LABEL_KEY[session.type])}
                  </span>
                </div>

                <div className="text-xs text-muted-foreground space-y-1">
                  <p className="flex items-start gap-1">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
                    <span className="break-all">
                      {session.address ??
                        `${session.lat.toFixed(5)}, ${session.lng.toFixed(5)}`}
                    </span>
                  </p>
                  <p>{t("sosTrackingLastUpdate", { time: updatedAtLabel })}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleNavigate}
                  className="flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm shadow-sm hover:bg-primary/95 hover:shadow transition-all"
                >
                  <Navigation className="h-4 w-4" />
                  {t("sosTrackingNavigate")}
                </button>
                <button
                  type="button"
                  onClick={centerOnRequester}
                  aria-label={t("sosTrackingLocate")}
                  title={t("sosTrackingLocate")}
                  className="shrink-0 flex items-center justify-center py-2 px-3 rounded-xl bg-muted text-foreground font-semibold text-sm hover:bg-muted/80 transition-all"
                >
                  <Locate className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      )}

      {/* Resolved Dialog */}
      <Dialog open={showResolvedDialog} onOpenChange={setShowResolvedDialog}>
        <DialogContent className="max-w-md rounded-2xl p-6 pointer-events-auto">
          <div className="space-y-4 flex flex-col items-center py-2 text-center">
            <span className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
              <Check className="h-6 w-6 text-green-600" />
            </span>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-center">
                {t("sosResolvedTitle")}
              </DialogTitle>
              <p className="text-sm text-muted-foreground text-center">
                {resolvedMessage}
              </p>
            </DialogHeader>
            <button
              type="button"
              onClick={() => {
                setShowResolvedDialog(false);
                setPhase("none");
              }}
              className="w-full py-2.5 px-4 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/95 transition-colors"
            >
              {t("sosClose")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
