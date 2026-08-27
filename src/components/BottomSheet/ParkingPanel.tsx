"use client";

import {
  ArrowUpRight,
  Car,
  CircleParking,
  Loader2,
  MapPin,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useFetchLocation } from "@/hook/useFetchLocation";
import { useAppTranslation } from "@/i18n/client";
import { getNearbyParking } from "@/lib/api/a11y";
import { haversineMeters } from "@/lib/geo";
import { geoCoords } from "@/lib/utils";
import useMapStore from "@/stores/useMapStore";
import { formatDistance, type ParkingNearbyItem } from "@/types/route";
import { Badge } from "../ui/badge";

/** TDX CarParkType：1 平面 / 2 立體 / 3 地下 / 4 停車塔 / 5 機械式。 */
export function carParkTypeLabel(
  t: (key: string, opts?: Record<string, unknown>) => string,
  type?: number,
): string | null {
  switch (type) {
    case 1:
      return t("parkingTypeSurface");
    case 2:
      return t("parkingTypeMultiStory");
    case 3:
      return t("parkingTypeUnderground");
    case 4:
      return t("parkingTypeTower");
    case 5:
      return t("parkingTypeMechanical");
    default:
      return null;
  }
}

/**
 * TDX ChargeTypes：1 計時 / 2 計次 / 3 月租 / 4 免費。
 * 其它值（如 TDX 未知 sentinel 255）沒有實際資訊，直接略過不顯示。
 */
export function chargeTypesLabels(
  t: (key: string, opts?: Record<string, unknown>) => string,
  types?: number[],
): { code: number; label: string }[] {
  if (!types?.length) return [];
  return types.flatMap((code) => {
    let label: string | null;
    switch (code) {
      case 1:
        label = t("chargeTypeHourly");
        break;
      case 2:
        label = t("chargeTypePerEntry");
        break;
      case 3:
        label = t("chargeTypeMonthly");
        break;
      case 4:
        label = t("chargeTypeFree");
        break;
      default:
        label = null;
    }
    return label ? [{ code, label }] : [];
  });
}

/** 取出任一種停車項目的座標；停車場與路邊格位都只有 GeoJSON `location`。 */
export function parkingItemLngLat(item: ParkingNearbyItem): {
  lng: number;
  lat: number;
} | null {
  return geoCoords(item.location);
}

function ParkingCard({
  item,
  distance,
  isSelected,
  onSelect,
}: {
  item: ParkingNearbyItem;
  distance: number;
  isSelected?: boolean;
  onSelect: (item: ParkingNearbyItem) => void;
}) {
  const { t } = useAppTranslation();

  const title = item.type === "lot" ? item.name : item.placeName;
  const subtitle =
    item.type === "lot"
      ? (item.address ?? undefined)
      : item.district || undefined;

  const badges: React.ReactNode[] = [];
  if (item.type === "lot") {
    const typeLabel = carParkTypeLabel(t, item.carParkType);
    if (typeLabel) {
      badges.push(
        <Badge key="type" variant="outline" className="text-xs">
          {typeLabel}
        </Badge>,
      );
    }
    chargeTypesLabels(t, item.chargeTypes).forEach(({ code, label }) => {
      badges.push(
        <Badge key={`charge_${code}`} variant="outline" className="text-xs">
          {label}
        </Badge>,
      );
    });
    if (item.wheelchairAccessible) {
      badges.push(
        <Badge
          key="wheelchair"
          className="border-transparent bg-emerald-500/10 text-emerald-600"
        >
          {t("wheelchairFriendly")}
        </Badge>,
      );
    }
  } else if (item.isMarked) {
    badges.push(
      <Badge
        key="marked"
        variant="secondary"
        className="text-xs text-indigo-600 bg-indigo-500/10"
      >
        {t("marked")}
      </Badge>,
    );
  }

  const infoLines: React.ReactNode[] = [];
  if (item.type === "lot") {
    if (item.disabledSpaces != null || item.totalCarSpaces != null) {
      infoLines.push(
        <span key="spaces" className="flex items-center gap-1.5">
          <Users className="h-3 w-3 shrink-0" />
          <span>
            {item.disabledSpaces != null
              ? t("disabledSpaces", { count: item.disabledSpaces })
              : null}
            {item.disabledSpaces != null && item.totalCarSpaces != null
              ? " · "
              : null}
            {item.totalCarSpaces != null
              ? t("totalCarSpaces", { count: item.totalCarSpaces })
              : null}
          </span>
        </span>,
      );
    }
  } else {
    infoLines.push(
      <span key="spots" className="flex items-center gap-1.5">
        <Car className="h-3 w-3 shrink-0" />
        {t("spots", { count: item.quantity })}
      </span>,
    );
    if (item.chargeType) {
      infoLines.push(
        <span key="charge" className="flex items-center gap-1.5">
          <MapPin className="h-3 w-3 shrink-0" />
          {t("chargeType")}: {item.chargeType}
        </span>,
      );
    }
  }
  if (item.type !== "lot" && item.spaceLabel) {
    infoLines.push(<span key="spaceLabel">{item.spaceLabel}</span>);
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      aria-label={`${t("viewOnMap")} ${title}`}
      className={`w-full text-left p-3 rounded-xl border transition-all space-y-2 cursor-pointer ${
        isSelected
          ? "bg-indigo-500/10 border-indigo-500/50 shadow-sm"
          : "bg-muted/40 border-border/30 hover:bg-muted/70"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-indigo-500/10 flex items-center justify-center shrink-0">
          <CircleParking className="h-4 w-4 text-indigo-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{title}</p>
          {subtitle && (
            <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatDistance(distance)}
          </span>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground/50" />
        </div>
      </div>

      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pl-12">{badges}</div>
      )}

      {infoLines.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground pl-12">
          {infoLines}
        </div>
      )}
    </button>
  );
}

export default function ParkingPanel({
  onClose,
  hideHeader,
}: {
  onClose: () => void;
  hideHeader?: boolean;
}) {
  const { t } = useAppTranslation();
  const {
    userLocation,
    map,
    nearbyParking,
    setNearbyParking,
    selectedParking,
    setSelectedParking,
  } = useMapStore(
    useShallow((s) => ({
      userLocation: s.userLocation,
      map: s.map,
      nearbyParking: s.nearbyParking,
      setNearbyParking: s.setNearbyParking,
      selectedParking: s.selectedParking,
      setSelectedParking: s.setSelectedParking,
    })),
  );
  const [data, setData] = useState<ParkingNearbyItem[]>(() => nearbyParking);
  const [loading, setLoading] = useState(() => nearbyParking.length === 0);
  const [error, setError] = useState<string | null>(null);

  // 距離門檻 gate：GPS 每 1~3 秒抖動一次，位移 < 100m 不重新 fetch
  // （見 hook/useFetchLocation.ts），避免一分鐘打爆 per-IP rate limit。
  const fetchLoc = useFetchLocation(userLocation);

  useEffect(() => {
    if (!fetchLoc) {
      setLoading(false);
      setError(t("noLocation"));
      return;
    }
    setLoading(true);
    setError(null);

    getNearbyParking(fetchLoc.lat, fetchLoc.lng)
      .then((res) => {
        if (res.ok && res.data) {
          setData(res.data);
          setNearbyParking(res.data);
        } else {
          setError(t("noData"));
        }
      })
      .catch(() => {
        setError(t("networkError"));
      })
      .finally(() => setLoading(false));
  }, [fetchLoc, setNearbyParking, t]);

  const handleSelect = (item: ParkingNearbyItem) => {
    setSelectedParking(item);
    if (!map) return;
    const pos = parkingItemLngLat(item);
    if (!pos) return;
    map.flyTo({ center: [pos.lng, pos.lat], zoom: 17 });
  };

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            <CircleParking className="h-4.5 w-4.5 text-indigo-600" />
            {t("parking")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="text-center py-8 space-y-2">
          <Car className="h-8 w-8 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : data.length === 0 ? (
        <div className="text-center py-8 space-y-2">
          <Car className="h-8 w-8 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {t("noNearbyParking")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {t("foundNearbyParking", { count: data.length })}
          </p>
          {data.map((item) => {
            const pos = parkingItemLngLat(item);
            const distance =
              userLocation && pos
                ? haversineMeters(userLocation, {
                    lat: pos.lat,
                    lng: pos.lng,
                  })
                : Number.NaN;
            return (
              <ParkingCard
                key={item._id}
                item={item}
                distance={distance}
                isSelected={selectedParking?._id === item._id}
                onSelect={handleSelect}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
