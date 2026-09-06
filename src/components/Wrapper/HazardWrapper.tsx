"use client";

import { AlertTriangle, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import { Marker, Popup } from "react-map-gl/maplibre";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { useAppTranslation } from "@/i18n/client";
import { confirmHazardReport, getNearbyHazardReports } from "@/lib/api/a11y";
import { ApiError } from "@/lib/fetch";
import useAuthStore from "@/stores/useAuthStore";
import useMapStore from "@/stores/useMapStore";
import type { HazardReport } from "@/types/route";

const VOTE_ERROR_MESSAGE_KEYS: Record<string, string> = {
  SELF_CONFIRMATION: "hazardVoteSelfConfirmation",
  ALREADY_VOTED: "hazardVoteAlreadyVoted",
  REPORT_NOT_FOUND: "hazardVoteReportNotFound",
  REPORT_EXPIRED: "hazardVoteReportExpired",
};

export default function HazardWrapper() {
  const { t } = useAppTranslation();
  const { userLocation } = useMapStore(
    useShallow((s) => ({ userLocation: s.userLocation })),
  );
  const user = useAuthStore((s) => s.user);
  const [hazards, setHazards] = useState<HazardReport[]>([]);
  const [selected, setSelected] = useState<HazardReport | null>(null);
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());
  const [votingId, setVotingId] = useState<string | null>(null);

  useEffect(() => {
    if (!userLocation) return;
    getNearbyHazardReports(userLocation.lat, userLocation.lng, 1000)
      .then((res) => {
        if (res.ok && res.data?.reports) setHazards(res.data.reports);
      })
      .catch(() => {});
  }, [userLocation]);

  const handleVote = async (
    report: HazardReport,
    action: "confirm" | "deny",
  ) => {
    setVotingId(report._id);
    try {
      const res = await confirmHazardReport(report._id, action);
      if (res.ok && res.data) {
        const { confirmCount, denyCount } = res.data;
        setHazards((prev) =>
          prev.map((h) =>
            h._id === report._id ? { ...h, confirmCount, denyCount } : h,
          ),
        );
        setSelected((prev) =>
          prev && prev._id === report._id
            ? { ...prev, confirmCount, denyCount }
            : prev,
        );
        setVotedIds((prev) => new Set(prev).add(report._id));
        toast.success(
          t(
            action === "confirm"
              ? "hazardVoteConfirmSuccess"
              : "hazardVoteDenySuccess",
          ),
        );
      }
    } catch (err) {
      if (err instanceof ApiError && err.reason) {
        const messageKey = VOTE_ERROR_MESSAGE_KEYS[err.reason];
        if (messageKey) {
          toast.error(t(messageKey));
          if (err.reason === "ALREADY_VOTED") {
            setVotedIds((prev) => new Set(prev).add(report._id));
          }
          return;
        }
      }
      toast.error(t("hazardVoteFailed"));
    } finally {
      setVotingId(null);
    }
  };

  if (hazards.length === 0) return null;

  return (
    <>
      {hazards.map((h) => {
        const [lng, lat] = h.reportedLocation.coordinates;
        return (
          <Marker
            key={h._id}
            longitude={lng}
            latitude={lat}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              setSelected(h);
            }}
          >
            <div className="h-7 w-7 rounded-full bg-amber-500 flex items-center justify-center shadow-md cursor-pointer hover:scale-110 transition-transform">
              <AlertTriangle className="h-3.5 w-3.5 text-white" />
            </div>
          </Marker>
        );
      })}

      {selected && (
        <Popup
          longitude={selected.reportedLocation.coordinates[0]}
          latitude={selected.reportedLocation.coordinates[1]}
          anchor="bottom"
          onClose={() => setSelected(null)}
          closeOnClick={false}
          className="[&_.maplibregl-popup-content]:rounded-xl [&_.maplibregl-popup-content]:p-3 [&_.maplibregl-popup-content]:shadow-lg"
        >
          <div className="space-y-1 min-w-[160px]">
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              {t(
                selected.hazardType === "data_error"
                  ? "dataError"
                  : selected.hazardType,
              )}
            </p>
            {selected.description && (
              <p className="text-xs text-muted-foreground">
                {selected.description}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {selected.status === "verified" ? t("confirmed") : t("pending")}
              {selected.confirmCount != null &&
                ` · ${selected.confirmCount} ${t("confirmed")}`}
            </p>
            {selected.status === "pending" &&
              selected.reporterId !== user?._id &&
              (votedIds.has(selected._id) ? (
                <p className="text-xs italic text-muted-foreground">
                  {t("hazardVoted")}
                </p>
              ) : (
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleVote(selected, "confirm")}
                    disabled={votingId === selected._id}
                    className="flex items-center gap-1 rounded-md bg-emerald-500 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    <ThumbsUp className="h-3 w-3" />
                    {t("confirmHazard")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleVote(selected, "deny")}
                    disabled={votingId === selected._id}
                    className="flex items-center gap-1 rounded-md bg-neutral-400 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    <ThumbsDown className="h-3 w-3" />
                    {t("denyHazard")}
                  </button>
                </div>
              ))}
          </div>
        </Popup>
      )}
    </>
  );
}
