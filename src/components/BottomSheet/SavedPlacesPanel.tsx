"use client";

import { Bookmark, MapPin, Navigation, Tag, Trash2, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppTranslation } from "@/i18n/client";
import { refreshVenuePlace } from "@/lib/indoor/catalog";
import { cn } from "@/lib/utils";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore, {
  placeKey,
  SAVED_PLACE_CATEGORIES,
  type SavedPlaceCategory,
} from "@/stores/useMapStore";
import type { PlaceDetail } from "@/types";

function SavedPlaceCard({
  item,
  category,
  onNavigate,
  onRemove,
  onCategoryChange,
}: {
  item: PlaceDetail;
  category: SavedPlaceCategory | undefined;
  onNavigate: (item: PlaceDetail) => void;
  onRemove: (item: PlaceDetail) => void;
  onCategoryChange: (
    item: PlaceDetail,
    category: SavedPlaceCategory | null,
  ) => void;
}) {
  const { t } = useAppTranslation();
  const name =
    item.kind === "place"
      ? item.place.name || item.place.fullAddress
      : item.address;
  const address = item.kind === "place" ? item.place.fullAddress : undefined;

  return (
    <div className="group p-3 rounded-xl bg-muted/40 border border-border/30 hover:bg-muted/60 transition-colors">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <MapPin className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{name}</p>
          {address && name !== address && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {address}
            </p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium shrink-0 transition-colors",
                category
                  ? "bg-primary/10 text-primary hover:bg-primary/20"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
              aria-label={t("setCategory")}
            >
              <Tag className="h-3 w-3" />
              {category ? t(`savedCategory.${category}`) : t("setCategory")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[120px]">
            {SAVED_PLACE_CATEGORIES.map((cat) => (
              <DropdownMenuItem
                key={cat}
                onClick={() => onCategoryChange(item, cat)}
                className={cn(
                  "text-sm rounded-md",
                  category === cat && "bg-primary/10 font-medium",
                )}
              >
                {t(`savedCategory.${cat}`)}
              </DropdownMenuItem>
            ))}
            {category && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onCategoryChange(item, null)}
                  className="text-sm rounded-md text-muted-foreground"
                >
                  {t("savedCategoryNone")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center gap-2 mt-2.5 pl-12">
        <button
          type="button"
          onClick={() => onNavigate(item)}
          className="flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
          aria-label={`${t("viewOnMap")} ${name}`}
        >
          <Navigation className="h-3 w-3" />
          {t("viewOnMap")}
        </button>
        <button
          type="button"
          onClick={() => onRemove(item)}
          className="flex items-center gap-1.5 text-xs text-destructive/70 hover:text-destructive font-medium ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label={`${t("unsavePlace")} ${name}`}
        >
          <Trash2 className="h-3 w-3" />
          {t("unsavePlace")}
        </button>
      </div>
    </div>
  );
}

export default function SavedPlacesPanel({
  onClose,
  hideHeader,
}: {
  onClose: () => void;
  hideHeader?: boolean;
}) {
  const { t } = useAppTranslation();
  const {
    savedPlaces,
    savedPlaceCategories,
    setSavedPlaceCategory,
    removeSavedPlace,
    map,
    setSearchPlace,
    setInfoShow,
    setSheetMode,
  } = useMapStore(
    useShallow((s) => ({
      savedPlaces: s.savedPlaces,
      savedPlaceCategories: s.savedPlaceCategories,
      setSavedPlaceCategory: s.setSavedPlaceCategory,
      removeSavedPlace: s.removeSavedPlace,
      map: s.map,
      setSearchPlace: s.setSearchPlace,
      setInfoShow: s.setInfoShow,
      setSheetMode: s.setSheetMode,
    })),
  );
  const [filter, setFilter] = useState<SavedPlaceCategory | "all">("all");

  const handleNavigate = useCallback(
    (item: PlaceDetail) => {
      if (item.kind === "venue-place") {
        const catalog = useIndoorCatalog.getState();
        const current = refreshVenuePlace(catalog.models, item);
        if (!current) {
          toast.error("此校園地點的資料已更新或尚未載入，請重新搜尋。");
          return;
        }
        setSearchPlace(current);
        setInfoShow({ ...current, isOpen: true });
        catalog.previewPlace(current);
        setSheetMode("place");
        return;
      }
      setSearchPlace(item);
      if (item.kind === "place") {
        setInfoShow({ isOpen: true, kind: "place", place: item.place });
        if (map)
          map.flyTo({
            center: [item.position.lng, item.position.lat],
            zoom: 17,
          });
      } else if (item.kind === "coordinate") {
        setInfoShow({
          isOpen: true,
          kind: "coordinate",
          address: item.address,
          position: item.position,
        });
        if (map)
          map.flyTo({
            center: [item.position.lng, item.position.lat],
            zoom: 17,
          });
      }
      setSheetMode("place");
    },
    [map, setSearchPlace, setInfoShow, setSheetMode],
  );

  const handleRemove = useCallback(
    (item: PlaceDetail) => {
      removeSavedPlace(item);
    },
    [removeSavedPlace],
  );

  // Only surface filter chips for categories actually in use.
  const usedCategories = useMemo(
    () =>
      SAVED_PLACE_CATEGORIES.filter((cat) =>
        savedPlaces.some((p) => savedPlaceCategories[placeKey(p)] === cat),
      ),
    [savedPlaces, savedPlaceCategories],
  );

  const filteredPlaces = useMemo(
    () =>
      filter === "all"
        ? savedPlaces
        : savedPlaces.filter(
            (p) => savedPlaceCategories[placeKey(p)] === filter,
          ),
    [filter, savedPlaces, savedPlaceCategories],
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            <Bookmark className="h-4.5 w-4.5 text-primary" />
            {t("savedPlaces")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted transition-colors"
            aria-label={t("close")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Count */}
      {savedPlaces.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("savedPlacesCount", { count: savedPlaces.length })}
        </p>
      )}

      {/* Category filter */}
      {usedCategories.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {(["all", ...usedCategories] as const).map((cat) => {
            const active = filter === cat;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setFilter(cat)}
                className={cn(
                  "px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted",
                )}
                aria-pressed={active}
              >
                {cat === "all"
                  ? t("savedCategoryAll")
                  : t(`savedCategory.${cat}`)}
              </button>
            );
          })}
        </div>
      )}

      {/* List */}
      {savedPlaces.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <Bookmark className="h-10 w-10 mx-auto text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">{t("noSavedPlaces")}</p>
          <p className="text-xs text-muted-foreground/70">
            {t("noSavedPlacesHint")}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredPlaces.map((item) => (
            <SavedPlaceCard
              key={placeKey(item)}
              item={item}
              category={savedPlaceCategories[placeKey(item)]}
              onNavigate={handleNavigate}
              onRemove={handleRemove}
              onCategoryChange={setSavedPlaceCategory}
            />
          ))}
        </div>
      )}
    </div>
  );
}
