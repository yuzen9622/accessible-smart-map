"use client";

import {
  Accessibility,
  AlertTriangle,
  ArrowUpDown,
  ArrowUpRight,
  CircleParking,
  DoorOpen,
  MapPin,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useFetchLocation } from "@/hook/useFetchLocation";
import { useAppTranslation } from "@/i18n/client";
import { getNearbyHazardReports, getNearbyParking } from "@/lib/api/a11y";
import { haversineMeters } from "@/lib/geo";
import { cn, geoCoords } from "@/lib/utils";
import useMapStore from "@/stores/useMapStore";
import { A11yEnum } from "@/types";
import {
  formatDistance,
  type HazardReport,
  type ParkingNearbyItem,
} from "@/types/route";
import { AccessibilityIcon } from "../ui/accessibility-icon";
import { Badge } from "../ui/badge";

export default function A11yPanel({
  onClose,
  hideHeader,
}: {
  onClose?: () => void;
  hideHeader?: boolean;
}) {
  const { t } = useAppTranslation();
  const {
    map,
    userLocation,
    a11yPlaces,
    selectedA11yTypes,
    toggleA11yType,
    setStoreNearbyParking,
  } = useMapStore(
    useShallow((s) => ({
      map: s.map,
      userLocation: s.userLocation,
      a11yPlaces: s.a11yPlaces,
      selectedA11yTypes: s.selectedA11yTypes,
      toggleA11yType: s.toggleA11yType,
      setStoreNearbyParking: s.setNearbyParking,
    })),
  );
  const [nearbyHazards, setNearbyHazards] = useState<HazardReport[]>([]);
  const [nearbyParking, setNearbyParking] = useState<ParkingNearbyItem[]>([]);

  // 距離門檻 gate：GPS 每 1~3 秒抖動一次，位移 < 100m 不重新 fetch
  // （見 hook/useFetchLocation.ts）——停車與回報查詢共用同一個基準點。
  const fetchLoc = useFetchLocation(userLocation);

  useEffect(() => {
    if (!fetchLoc) return;
    const controller = new AbortController();
    getNearbyHazardReports(fetchLoc.lat, fetchLoc.lng, 500, controller.signal)
      .then((res) => {
        if (!controller.signal.aborted && res.ok && res.data?.reports)
          setNearbyHazards(res.data.reports);
      })
      .catch(() => {});
    getNearbyParking(fetchLoc.lat, fetchLoc.lng)
      .then((res) => {
        if (!controller.signal.aborted && res.ok && res.data) {
          setNearbyParking(res.data);
          setStoreNearbyParking(res.data);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [fetchLoc, setStoreNearbyParking]);

  const a11yChips = [
    { type: A11yEnum.ELEVATOR, Icon: ArrowUpDown, label: t("elevator") },
    { type: A11yEnum.RAMP, Icon: Accessibility, label: t("ramp") },
    { type: A11yEnum.RESTROOM, Icon: DoorOpen, label: t("toilet") },
  ];

  // Facilities + disabled parking merged into one distance-sorted list.
  const nearbyItems = useMemo(() => {
    if (!userLocation) return [];
    const facilities = (a11yPlaces ?? []).map((p) => ({
      key: `f_${p.id}`,
      kind: "facility" as const,
      title: p.content?.title || t("a11yDefaultTitle"),
      desc: p.content?.desc || "",
      position: p.position,
      distance: haversineMeters(userLocation, p.position),
    }));
    const parking = nearbyParking.flatMap((p) => {
      const position = geoCoords(p.location);
      if (!position) return [];
      const { title, desc } =
        p.type === "lot"
          ? {
              title: p.name,
              desc:
                [
                  p.address,
                  p.wheelchairAccessible ? t("wheelchairFriendly") : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined,
            }
          : {
              title: p.placeName,
              desc: `${p.district ?? ""} · ${t("spots", { count: p.quantity })}`,
            };
      return [
        {
          key: `p_${p._id}`,
          kind: "parking" as const,
          title,
          desc,
          position,
          distance: haversineMeters(userLocation, position),
        },
      ];
    });
    return [...facilities, ...parking]
      .filter((e) => e.distance < 2000)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 10);
  }, [a11yPlaces, nearbyParking, userLocation, t]);

  const handleFlyToPlace = useCallback(
    (lng: number, lat: number) => {
      if (map) map.flyTo({ center: [lng, lat], zoom: 17 });
    },
    [map],
  );

  return (
    <div className="space-y-5">
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            <AccessibilityIcon
              size={18}
              isAnimated={false}
              className="text-accessibility"
            />
            {t("accessibleTitle")}
          </h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="h-7 w-7 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted"
              aria-label={t("close")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Facility type filter — toggles map pins */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {t("a11yFilterHint")}
        </h3>
        <div className="flex gap-2 flex-wrap">
          {a11yChips.map((chip) => {
            const active = selectedA11yTypes.has(chip.type);
            return (
              <button
                key={chip.type}
                type="button"
                onClick={() => toggleA11yType(chip.type)}
                aria-pressed={active}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium transition-all",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted",
                )}
              >
                <chip.Icon className="h-4 w-4" />
                <span>{chip.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Nearby facilities with distance */}
      <section aria-busy={a11yPlaces === null}>
        <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
          <Accessibility className="h-4 w-4" />
          {t("nearbyA11y")}
        </h3>
        {a11yPlaces === null ? (
          // `a11yPlaces` is `null` until the first fetch resolves (see
          // useMapStore) — distinct from `[]` ("checked, found none"). Without
          // this branch, the still-loading state and the genuinely-empty
          // state rendered the identical "沒有找到附近的無障礙設施" message,
          // so a slow connection looked exactly like an empty area.
          <div role="status" className="space-y-2">
            <span className="sr-only">{t("loading", "載入中…")}</span>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                aria-hidden="true"
                className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 animate-pulse"
              >
                <div className="h-9 w-9 rounded-full bg-muted shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3.5 w-2/3 rounded bg-muted" />
                  <div className="h-3 w-1/3 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : nearbyItems.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            {t("noNearbyA11y")}
          </p>
        ) : (
          <div className="space-y-2">
            {nearbyItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() =>
                  handleFlyToPlace(item.position.lng, item.position.lat)
                }
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-muted/40 hover:bg-muted/70 transition-colors text-left"
              >
                <div
                  className={cn(
                    "h-9 w-9 rounded-full flex items-center justify-center shrink-0",
                    item.kind === "parking"
                      ? "bg-indigo-500/10"
                      : "bg-primary/10",
                  )}
                >
                  {item.kind === "parking" ? (
                    <CircleParking className="h-4 w-4 text-indigo-500" />
                  ) : (
                    <MapPin className="h-4 w-4 text-primary" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.title}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {item.desc}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {formatDistance(item.distance)}
                </span>
                <ArrowUpRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Nearby hazards */}
      {nearbyHazards.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {t("nearbyHazards")}
          </h3>
          <div className="space-y-2">
            {nearbyHazards.slice(0, 3).map((hazard) => (
              <div
                key={hazard._id}
                className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/10"
              >
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">
                    {t(
                      hazard.hazardType === "data_error"
                        ? "dataError"
                        : hazard.hazardType,
                    )}
                  </p>
                  {hazard.description && (
                    <p className="text-xs text-muted-foreground truncate">
                      {hazard.description}
                    </p>
                  )}
                </div>
                <Badge
                  variant={
                    hazard.status === "verified" ? "default" : "secondary"
                  }
                  className="text-xs shrink-0"
                >
                  {hazard.status === "verified" ? t("confirmed") : t("pending")}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
