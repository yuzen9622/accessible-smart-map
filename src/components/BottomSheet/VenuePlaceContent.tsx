"use client";

import {
  ArrowLeft,
  ArrowUpDown,
  Bookmark,
  Building2,
  Footprints,
  Navigation,
} from "lucide-react";
import {
  featureForVenuePlace,
  placeForVenueFeature,
  toVenuePlaceDetail,
} from "@/lib/indoor/catalog";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore from "@/stores/useMapStore";
import type { VenueFeatureDetail, VenuePlaceDetail } from "@/types";
import { Button } from "../ui/button";

/** Place details occupy the existing place sheet, including non-boarding shafts. */
export default function VenuePlaceContent({
  detail,
}: {
  detail: VenuePlaceDetail | VenueFeatureDetail;
}) {
  const models = useIndoorCatalog((s) => s.models);
  const model = models.find(
    (item) =>
      item.venueId === detail.venueId &&
      (detail.buildingId === null || item.building.id === detail.buildingId),
  );
  const feature =
    model &&
    (detail.kind === "venue-feature"
      ? model.features.find((item) => item.id === detail.featureId)
      : featureForVenuePlace(model, detail.placeId));
  const rawPlace =
    model &&
    (detail.kind === "venue-place"
      ? model.places.find((item) => item.id === detail.placeId)
      : feature && placeForVenueFeature(model, feature));
  const place = rawPlace && model ? toVenuePlaceDetail(model, rawPlace) : null;
  const connection = model?.connections.find(
    (item) =>
      item.id === feature?.connectionId ||
      item.id === rawPlace?.connectionId ||
      (detail.kind === "venue-feature" && item.id === detail.featureId),
  );
  const kind =
    feature?.displayKind ?? connection?.kind ?? feature?.kind ?? rawPlace?.kind;
  const elevator = kind === "elevator";
  const stairs = kind === "stairs" || kind === "steps";
  const stops = [...new Set(connection?.levelRefs.filter(Boolean) ?? [])];
  const serves =
    !elevator || !detail.levelRef || stops.includes(detail.levelRef);
  const saved = useMapStore((s) => (place ? s.isSavedPlace(place) : false));
  const title =
    elevator && connection?.tags.ref
      ? `電梯 ${connection.tags.ref}`
      : detail.name;
  const Icon = elevator ? ArrowUpDown : stairs ? Footprints : Building2;
  const back = () => {
    const state = useMapStore.getState();
    state.setInfoShow({ kind: null, isOpen: false });
    state.setSearchPlace(null);
    state.setSheetMode("home");
    useIndoorCatalog.getState().setSelectedFeatureId(null);
  };
  const plan = (target: "origin" | "destination") => {
    if (!place) return;
    const state = useMapStore.getState();
    if (state.isNavigating) {
      state.requestNavExit("plan");
      return;
    }
    if (target === "origin") {
      state.setOrigin(place);
      state.setOriginName(place.name);
    } else {
      state.setDestination(place);
      state.setDestinationName(place.name);
    }
    state.setSheetMode("plan");
    state.setMobileSheetSnap("half");
  };
  return (
    <div className="space-y-5" data-testid="venue-place-details">
      <div className="flex items-center gap-3">
        <Button
          size="icon"
          variant="ghost"
          className="rounded-full shrink-0"
          aria-label="返回搜尋"
          onClick={back}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="rounded-xl bg-primary/10 p-3 text-primary">
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {model?.building.name ?? "校園地點"} · {detail.levelRef ?? "戶外"}
          </p>
          <h1 className="font-bold text-xl leading-snug">{title}</h1>
        </div>
      </div>
      {elevator && (
        <div className="space-y-3 rounded-xl bg-primary/5 border border-primary/15 p-4">
          <p className="text-sm font-medium">停靠樓層</p>
          <div className="flex flex-wrap gap-2">
            {stops.map((stop) => (
              <span
                key={stop}
                className="rounded-md bg-background border border-border px-2.5 py-1 text-sm"
              >
                {stop}
              </span>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {connection?.wheelchair === "yes"
              ? "可搭乘輪椅"
              : "輪椅通行資訊待確認"}
          </p>
          {!serves && (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              此電梯在 {detail.levelRef} 不停靠，請選擇其他電梯。
            </p>
          )}
        </div>
      )}
      {stairs && (
        <p className="text-sm text-muted-foreground">
          樓梯不供輪椅通行。規劃無障礙路線時會使用電梯與可通行的坡道。
        </p>
      )}
      {place?.arrivalKind === "corridor" && (
        <p className="text-sm text-muted-foreground">
          路線到達此空間前的公共走道，請依現場標示確認入口。
        </p>
      )}
      {!place && !elevator && (
        <p className="text-sm text-muted-foreground">
          此空間尚無已確認的路線到達點。
        </p>
      )}
      {place && serves && (
        <div className="space-y-2">
          <Button
            className="w-full h-12 rounded-xl gap-2"
            onClick={() => plan("destination")}
          >
            <Navigation className="h-5 w-5" />
            規劃前往路線
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11 rounded-xl"
              onClick={() => plan("origin")}
            >
              設為起點
            </Button>
            <Button
              variant="outline"
              className="h-11 rounded-xl gap-2"
              aria-pressed={saved}
              onClick={() => {
                const state = useMapStore.getState();
                if (saved) state.removeSavedPlace(place);
                else state.addSavedPlace(place);
              }}
            >
              <Bookmark
                className="h-4 w-4"
                fill={saved ? "currentColor" : "none"}
              />
              {saved ? "已儲存" : "儲存地點"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
