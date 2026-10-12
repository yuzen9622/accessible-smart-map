"use client";

import {
  Building2,
  ExternalLink,
  Heart,
  Loader2,
  MapPin,
  Phone,
  Star,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppTranslation } from "@/i18n/client";
import { getNearbyWelfare } from "@/lib/api/a11y";
import { toApiLang } from "@/lib/place/lang";
import { nonemptyName } from "@/lib/route/sourceNames";
import useMapStore from "@/stores/useMapStore";
import type { WelfareInstitution } from "@/types/route";
import { Badge } from "../ui/badge";

function gradeColor(grade: string) {
  if (grade === "優" || grade === "甲") return "text-green-600 bg-green-500/10";
  if (grade === "乙") return "text-amber-600 bg-amber-500/10";
  return "text-muted-foreground bg-muted/60";
}

function WelfareCard({
  item,
  onNavigate,
}: {
  item: WelfareInstitution;
  onNavigate: (item: WelfareInstitution) => void;
}) {
  const { t } = useAppTranslation();
  const coords = item.location?.coordinates;

  return (
    <div className="p-3 rounded-xl bg-muted/40 border border-border/30 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">
            {nonemptyName(item.displayName) ||
              nonemptyName(item.name) ||
              t("welfare")}
          </p>
          <p className="text-xs text-muted-foreground truncate">{item.type}</p>
        </div>
        {item.evaluationGrade && (
          <Badge
            variant="secondary"
            className={`text-xs shrink-0 ${gradeColor(item.evaluationGrade)}`}
          >
            <Star className="h-3 w-3 mr-0.5" />
            {item.evaluationGrade}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MapPin className="h-3 w-3 shrink-0" />
        <span className="truncate">
          {nonemptyName(item.displayAddress) || item.address}
        </span>
      </div>

      {item.phone && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Phone className="h-3 w-3 shrink-0" />
          <a
            href={`tel:${item.phone}`}
            className="text-primary hover:underline"
          >
            {item.phone}
          </a>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        {coords && (
          <button
            type="button"
            onClick={() => onNavigate(item)}
            className="flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            {t("viewOnMap")}
          </button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {t("capacity")}: {item.actualServed.residential}/
          {item.approvedCapacity.residential}
        </span>
      </div>
    </div>
  );
}

export default function WelfarePanel({
  onClose,
  hideHeader,
}: {
  onClose: () => void;
  hideHeader?: boolean;
}) {
  const { t, i18n } = useAppTranslation();
  const lang = toApiLang(i18n.language) ?? "zh-TW";
  const { userLocation, map } = useMapStore(
    useShallow((s) => ({ userLocation: s.userLocation, map: s.map })),
  );
  const [data, setData] = useState<WelfareInstitution[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setData([]);
    if (!userLocation) {
      setLoading(false);
      setError(t("noLocation"));
      return;
    }
    setLoading(true);
    setError(null);

    getNearbyWelfare(userLocation.lat, userLocation.lng, 3000, lang)
      .then((res) => {
        if (!active) return;
        if (res.ok && res.data) {
          setData(res.data);
        } else {
          setError(t("noData"));
        }
      })
      .catch(() => {
        if (!active) return;
        setError(t("networkError"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [userLocation, lang, t]);

  const handleNavigate = (item: WelfareInstitution) => {
    if (!item.location?.coordinates || !map) return;
    const [lng, lat] = item.location.coordinates;
    map.flyTo({ center: [lng, lat], zoom: 16 });
  };

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            <Heart className="h-4.5 w-4.5 text-rose-500" />
            {t("welfare")}
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
          <Building2 className="h-8 w-8 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      ) : data.length === 0 ? (
        <div className="text-center py-8 space-y-2">
          <Building2 className="h-8 w-8 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            {t("noNearbyWelfare")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {t("foundNearby", { count: data.length })}
          </p>
          {data.map((item) => (
            <WelfareCard
              key={item._id}
              item={item}
              onNavigate={handleNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
