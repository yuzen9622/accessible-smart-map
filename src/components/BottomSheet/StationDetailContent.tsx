"use client";

import { ArrowLeft, ArrowUpDown, DoorOpen, MapPin, Train } from "lucide-react";
import { useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppTranslation } from "@/i18n/client";
import { nonemptyName } from "@/lib/route/sourceNames";
import { geoCoords } from "@/lib/utils";
import useMapStore from "@/stores/useMapStore";
import type { IBathroom, metroA11yData } from "@/types";
import { Badge } from "../ui/badge";

// A station marker has no trustworthy place bounds; do not infer an extent.
const EMPTY_BATHROOMS: IBathroom[] = [];
const EMPTY_METRO: metroA11yData[] = [];
const EMPTY_GROUPS: [string, metroA11yData[]][] = [];

export default function StationDetailContent() {
  const { t } = useAppTranslation();
  const { selectA11yPlace, setSheetMode, setSelectA11yPlace, map } =
    useMapStore(
      useShallow((s) => ({
        selectA11yPlace: s.selectA11yPlace,
        setSheetMode: s.setSheetMode,
        setSelectA11yPlace: s.setSelectA11yPlace,
        map: s.map,
      })),
    );

  const nearbyBathrooms = EMPTY_BATHROOMS;
  const nearbyMetro = EMPTY_METRO;
  const loading = false;
  const position = selectA11yPlace?.position ?? null;

  const handleBack = useCallback(() => {
    setSelectA11yPlace(null);
    setSheetMode("home");
  }, [setSelectA11yPlace, setSheetMode]);

  const groupedByExit = EMPTY_GROUPS;

  if (!selectA11yPlace) return null;

  const stationName = selectA11yPlace.content?.title || t("stationDetail");

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t("back")}
          className="relative mt-1 h-8 w-8 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted transition-colors shrink-0 after:absolute after:inset-[-6px] after:content-['']"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold leading-tight flex items-center gap-2">
            <Train className="h-5 w-5 text-primary shrink-0" />
            {stationName}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("stationA11yFacilities")}
          </p>
        </div>
      </div>

      {/* Location */}
      {position && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" />
          {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : (
        <>
          {/* Grouped exits with elevators/ramps */}
          {groupedByExit.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                <ArrowUpDown className="h-4 w-4" />
                {t("exitInfo")} · {t("elevatorLocation")}
              </h2>
              <div className="space-y-2">
                {groupedByExit.map(([exit, items]) => (
                  <div key={exit} className="rounded-xl bg-muted/30 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge
                        variant="outline"
                        className="rounded-full text-xs font-semibold"
                      >
                        {exit}
                      </Badge>
                    </div>
                    <div className="space-y-1.5">
                      {items.map((m) => (
                        <button
                          key={m._id}
                          type="button"
                          onClick={() => {
                            const pos = geoCoords(m.location, m.緯度, m.經度);
                            if (map && pos)
                              map.flyTo({
                                center: [pos.lng, pos.lat],
                                zoom: 18,
                              });
                          }}
                          className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-muted/50 transition-colors text-left"
                        >
                          <div className="h-8 w-8 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
                            <ArrowUpDown className="h-3.5 w-3.5 text-green-600" />
                          </div>
                          <span className="text-sm flex-1 min-w-0 truncate">
                            {nonemptyName(m.displayName) ||
                              nonemptyName(m["出入口電梯/無障礙坡道名稱"]) ||
                              t("elevator")}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Nearby accessible bathrooms */}
          {nearbyBathrooms.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
                <DoorOpen className="h-4 w-4" />
                {t("accessibleToilet")}
              </h2>
              <div className="space-y-2">
                {nearbyBathrooms.map((b) => (
                  <button
                    key={b._id}
                    type="button"
                    onClick={() => {
                      const pos = geoCoords(
                        b.location,
                        b.latitude,
                        b.longitude,
                      );
                      if (map && pos)
                        map.flyTo({
                          center: [pos.lng, pos.lat],
                          zoom: 17,
                        });
                    }}
                    className="w-full flex items-center gap-3 p-3 rounded-xl bg-muted/40 hover:bg-muted/70 transition-colors text-left"
                  >
                    <div className="h-9 w-9 rounded-full bg-blue-500/10 flex items-center justify-center shrink-0">
                      <DoorOpen className="h-4 w-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {nonemptyName(b.displayName) ||
                          nonemptyName(b.name) ||
                          t("accessibleToilet")}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {nonemptyName(b.displayAddress) || b.address}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}

          {nearbyMetro.length === 0 && nearbyBathrooms.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t("noNearbyA11y")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
