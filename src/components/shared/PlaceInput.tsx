"use client";
import {
  ClockIcon,
  LoaderCircleIcon,
  SearchIcon,
} from "@animateicons/react/lucide";
import {
  Bath,
  Bike,
  Building,
  Building2,
  Bus,
  Coffee,
  Hospital,
  LoaderCircle,
  MapPin,
  Milestone,
  Navigation,
  School,
  Sparkles,
  Store,
  Train,
  TreePine,
  Utensils,
} from "lucide-react";
import type { InputHTMLAttributes } from "react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import useIsDesktop from "@/hook/useIsDesktop";
import usePlacePredictions from "@/hook/usePlacePredictions";
import { useAppTranslation } from "@/i18n/client";
import { getPlaceAutocomplete, getPlaceDetails } from "@/lib/api/placeSearch";
import { refreshVenuePlace, searchVenuePlaces } from "@/lib/indoor/catalog";
import { toApiLang } from "@/lib/place/lang";
import { cn } from "@/lib/utils";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore, { placeKey } from "@/stores/useMapStore";
import type { PlaceDetail, VenuePlaceDetail } from "@/types";
import type { AutocompleteItem, PlaceResult } from "@/types/place";
import { formatDistance } from "@/types/route";
import { Command, CommandGroup, CommandItem, CommandList } from "../ui/command";
import { Input } from "../ui/input";

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  onPlaceSelect: (places: PlaceDetail) => void;
  hideIcon?: boolean;
  onSearchRequest?: (query: string) => void;
  /**
   * Unified-input routing (§S5 item 1): when the user submits with no
   * autocomplete hit and the text reads like a question rather than a place
   * name, hand it to the AI assistant instead of trying (and failing) to
   * geocode it. A hit in `suggestions` always wins — this only fires when
   * the place search has already come up empty.
   */
  onAiQuery?: (query: string) => void;
};

const QUESTION_MARKERS = /[嗎呢如何怎麼哪裡哪邊有沒有可以嗎能不能為什麼?？]/;
// House numbers, floors, lane/alley markers (號/樓/巷/弄) — a long string
// carrying one of these reads as an address, not a question, even past the
// length threshold below. Address/place names essentially always carry a
// digit somewhere; genuine questions rarely do.
const HAS_DIGIT = /\d/;

function looksLikeAiQuery(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (QUESTION_MARKERS.test(trimmed)) return true;
  // Length alone is a weak signal — long place names/addresses are common in
  // Chinese — so it only counts once digits (house numbers, floors) rule out
  // "this is an address" first.
  return trimmed.length > 8 && !HAS_DIGIT.test(trimmed);
}

function getPlaceIcon(category?: string, type?: string) {
  // 1. Check specific type first
  if (type) {
    if (
      type === "train_station" ||
      type === "station" ||
      type === "subway" ||
      type === "subway_entrance" ||
      type === "tram_stop"
    ) {
      return Train;
    }
    if (type === "bus_stop" || type === "bus_station" || type === "bus") {
      return Bus;
    }
    if (type === "bicycle_rental" || type === "share_bicycle") {
      return Bike;
    }
    if (
      type === "restaurant" ||
      type === "food_court" ||
      type === "fast_food"
    ) {
      return Utensils;
    }
    if (type === "cafe" || type === "pub" || type === "bar") {
      return Coffee;
    }
    if (
      type === "supermarket" ||
      type === "convenience" ||
      type === "mall" ||
      type === "department_store" ||
      type === "shop"
    ) {
      return Store;
    }
    if (
      type === "hospital" ||
      type === "clinic" ||
      type === "doctors" ||
      type === "pharmacy"
    ) {
      return Hospital;
    }
    if (
      type === "school" ||
      type === "university" ||
      type === "college" ||
      type === "kindergarten"
    ) {
      return School;
    }
    if (
      type === "park" ||
      type === "garden" ||
      type === "nature_reserve" ||
      type === "recreation_ground"
    ) {
      return TreePine;
    }
    if (type === "toilets" || type === "shower") {
      return Bath;
    }
  }

  // 2. Fallback to category (class)
  if (category) {
    switch (category) {
      case "railway":
        return Train;
      case "highway":
        if (type === "bus_stop" || type === "bus_station") return Bus;
        return Milestone;
      case "amenity":
        return Building;
      case "shop":
        return Store;
      case "tourism":
      case "leisure":
        return Sparkles;
      case "building":
        return Building2;
      default:
        return MapPin;
    }
  }

  return MapPin;
}

function PlaceInput({
  onPlaceSelect,
  type = "search",
  className,
  placeholder = "今天想去哪兒...",
  value,
  onChange,
  hideIcon,
  onSearchRequest,
  onAiQuery,
  ...props
}: InputProps) {
  const { t, i18n } = useAppTranslation("translation");
  const lang = toApiLang(i18n.language);
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const models = useIndoorCatalog((state) => state.models);
  const query = (value as string) ?? "";
  const venueSuggestions = useMemo(
    () => searchVenuePlaces(models, query).slice(0, 12),
    [models, query],
  );
  const {
    searchHistory,
    addSearchHistory,
    userLocation,
    map,
    setMobileSheetSnap,
  } = useMapStore(
    useShallow((s) => ({
      searchHistory: s.searchHistory,
      addSearchHistory: s.addSearchHistory,
      userLocation: s.userLocation,
      map: s.map,
      setMobileSheetSnap: s.setMobileSheetSnap,
    })),
  );
  const { suggestions, loading, sessionToken, resetSession } =
    usePlacePredictions((value as string) || "");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const handleVenueSelect = useCallback(
    (place: VenuePlaceDetail) => {
      const current = refreshVenuePlace(models, place);
      if (!current) {
        toast.error("此校園地點的資料已更新或尚未載入，請重新搜尋。");
        return;
      }
      addSearchHistory(current);
      onPlaceSelect(current);
      setOpen(false);
      resetSession();
    },
    [models, addSearchHistory, onPlaceSelect, resetSession],
  );

  const resolvePlace = useCallback(
    async (item: AutocompleteItem) => {
      if (item.source === "osm" && item.location) {
        const [lng, lat] = item.location.coordinates;
        map?.flyTo({ center: [lng, lat], zoom: 17 });
      }

      const response = await getPlaceDetails(item.id, {
        sessiontoken: sessionToken,
        lat: userLocation?.lat,
        lng: userLocation?.lng,
        lang,
      });
      // Details (including facility displays) belong to the request locale.
      if (toApiLang(i18n.language) !== lang) return;
      if (!response.ok || !response.data) {
        throw new Error("Place details unavailable");
      }

      const place: PlaceResult = response.data;
      const [lng, lat] = place.location.coordinates;
      const placeDetail: PlaceDetail = {
        kind: "place",
        place,
        position: { lat, lng },
      };
      addSearchHistory(placeDetail);
      onPlaceSelect(placeDetail);
      setOpen(false);
      resetSession();
    },
    [
      addSearchHistory,
      i18n,
      lang,
      map,
      onPlaceSelect,
      resetSession,
      sessionToken,
      userLocation?.lat,
      userLocation?.lng,
    ],
  );

  const handlePlaceSubmit = useCallback(
    async (text: string) => {
      const query = text.trim();
      if (!query || pendingId) return;
      if (venueSuggestions.length) {
        // A room number can exist in several buildings or floors. Keep that
        // choice visible rather than silently resolving it through geocoding.
        if (venueSuggestions.length === 1)
          handleVenueSelect(venueSuggestions[0]);
        else {
          setOpen(true);
          toast.info("請從校園地點中選擇建築與樓層。");
        }
        return;
      }
      setPendingId("submit");
      try {
        const response = await getPlaceAutocomplete({
          q: query,
          sessiontoken: sessionToken,
          lat: userLocation?.lat,
          lng: userLocation?.lng,
          limit: 1,
          lang,
        });
        if (toApiLang(i18n.language) !== lang) return;
        const item = response.ok ? response.data?.[0] : undefined;
        if (!item) {
          toast.error("找不到符合的地點");
          return;
        }
        await resolvePlace(item);
      } catch {
        toast.error("無法取得地點詳細資料");
      } finally {
        setPendingId(null);
      }
    },
    [
      i18n,
      lang,
      pendingId,
      venueSuggestions,
      handleVenueSelect,
      resolvePlace,
      sessionToken,
      userLocation?.lat,
      userLocation?.lng,
    ],
  );

  const handlePlaceClick = useCallback(
    async (item: AutocompleteItem) => {
      if (pendingId) return;
      setPendingId(item.id);
      try {
        await resolvePlace(item);
      } catch {
        toast.error("無法取得地點詳細資料");
      } finally {
        setPendingId(null);
      }
    },
    [pendingId, resolvePlace],
  );

  const handleHistoryClick = useCallback(
    (history: PlaceDetail) => {
      onPlaceSelect(history);
      setOpen(false);
    },
    [onPlaceSelect],
  );

  const handleNowClick = async (loc?: { lat: number; lng: number }) => {
    if (!loc) {
      toast.error("無法取得目前位置");
      return;
    }
    const placeDetail: PlaceDetail = {
      kind: "coordinate",
      address: "你的位置",
      position: loc,
    };
    onPlaceSelect(placeDetail);
    setOpen(false);
  };

  // 沒有內容時不要撐出一塊空面板，否則會看到懸空的白框
  const hasPanelContent =
    query === "" ||
    venueSuggestions.length > 0 ||
    suggestions.length > 0 ||
    !!onSearchRequest;
  const panelOpen = open && hasPanelContent;

  return (
    <div
      className={cn(
        "relative w-full pointer-events-auto",
        // min-h-11: the 44px touch-target floor — the input itself is
        // `h-fit` (sized to its text line-height), so without this the
        // whole search bar's tappable height was effectively ~28px.
        hideIcon
          ? "bg-transparent px-1 py-0.5 min-h-11"
          : cn(
              "bg-card px-3 py-1 border border-border/50 shadow-sm min-h-11",
              panelOpen ? "rounded-t-3xl" : "rounded-3xl",
            ),
      )}
    >
      <div className={cn("w-full h-full flex items-center gap-2 px-2")}>
        {!hideIcon && (
          <SearchIcon size={16} className="text-muted-foreground shrink-0" />
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const text = (value as string) ?? "";
            if (
              onAiQuery &&
              !loading &&
              suggestions.length === 0 &&
              venueSuggestions.length === 0 &&
              looksLikeAiQuery(text)
            ) {
              onAiQuery(text.trim());
              setOpen(false);
              return;
            }
            await handlePlaceSubmit(text);
          }}
          className="flex-1 "
        >
          <Input
            type={type}
            placeholder={placeholder}
            tabIndex={0}
            {...props}
            className={cn(
              "  shadow-none  bg-transparent! h-fit ring-transparent focus-visible:ring-transparent",
              className,
            )}
            value={value}
            onChange={(e) => {
              onChange?.(e);
              setOpen(true);
            }}
            onFocus={(e) => {
              setOpen(true);
              if (!isDesktop) {
                setMobileSheetSnap("full");
              }
              props.onFocus?.(e);
            }}
            onBlur={(e) => {
              setTimeout(() => {
                setOpen(false);
              }, 100);
              props.onBlur?.(e);
            }}
          />
        </form>
        {loading && (
          <LoaderCircle className=" text-muted-foreground/50 animate-spin" />
        )}
      </div>
      {panelOpen && (
        <div
          className={cn(
            // 對齊外框左右邊界（-1px 抵掉 border 寬度），並蓋掉輸入框下緣的 border，
            // 讓下拉面板看起來是同一塊卡片往下延伸而不是另一個 menu
            "absolute -left-px -right-px top-full z-20",
            hideIcon && "left-0 right-0 mt-1.5",
          )}
        >
          <Command
            className={cn(
              "w-full text-start h-fit overflow-hidden",
              hideIcon
                ? "rounded-2xl border border-border/50 shadow-lg"
                : // rounded-none 先抵掉 Command 預設的 rounded-md（否則上緣會有小圓角，
                  // 看起來就是另一塊 menu）；border-t-transparent 讓上緣不留分隔線，
                  // 面板背景直接蓋掉輸入框的 border-b，變成同一塊面。
                  // 陰影不能用 shadow-sm：它會往上暈出 1~2px，在淺色主題就是一條接縫線，
                  // 改成只往下打的陰影（blur/2 - y - spread < 0 ⇒ 上緣無溢出）
                  "bg-card rounded-none rounded-b-3xl border border-border/50 border-t-transparent shadow-[0_4px_8px_-2px_rgb(0_0_0/0.08)]",
            )}
          >
            <CommandList
              className="px-1 pb-1"
              onMouseDown={(e) => e.preventDefault()}
            >
              {query === "" && (
                <CommandGroup heading={t("searchHistory")}>
                  <CommandItem
                    itemType="button"
                    onSelect={() => {
                      handleNowClick(userLocation ?? void 0);
                    }}
                    key={"now_location"}
                    className=" flex justify-between rounded-3xl items-center"
                  >
                    <span className="p-1 text-start flex items-center gap-2 text-emerald-500 dark:text-emerald-400">
                      <Navigation className="w-5 h-5" />
                      <span className="text-base font-medium">你的位置</span>
                    </span>
                  </CommandItem>
                  {searchHistory.map((history) => {
                    if (history.kind === "venue-place") {
                      return (
                        <CommandItem
                          itemType="button"
                          key={placeKey(history)}
                          onSelect={() => handleVenueSelect(history)}
                          className="flex items-start gap-3 rounded-3xl p-2 cursor-pointer"
                        >
                          <ClockIcon
                            size={16}
                            className="mt-1 text-muted-foreground shrink-0"
                          />
                          <div className="min-w-0 text-start">
                            <p className="font-medium truncate">
                              {history.name}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {[
                                history.buildingName,
                                history.levelRef ?? "校園戶外",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                        </CommandItem>
                      );
                    }
                    if (history.kind === "place") {
                      const { place } = history;
                      return (
                        <CommandItem
                          itemType="button"
                          onSelect={() => {
                            handleHistoryClick(history);
                          }}
                          key={placeKey(history)}
                          className="flex items-start gap-3 rounded-3xl p-2 cursor-pointer transition-colors"
                        >
                          <div className="mt-1 h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <ClockIcon
                              size={16}
                              className="text-muted-foreground"
                            />
                          </div>
                          <div className="flex-1 min-w-0 text-start">
                            <p className="font-medium text-foreground truncate">
                              {place.name || place.fullAddress}
                            </p>
                            <p className="text-xs text-muted-foreground/70 truncate">
                              {place.fullAddress}
                            </p>
                          </div>
                        </CommandItem>
                      );
                    }
                    return null;
                  })}
                </CommandGroup>
              )}
              {query !== "" && (
                <>
                  {venueSuggestions.length > 0 && (
                    <CommandGroup heading="校園地點">
                      {venueSuggestions.map((place) => (
                        <CommandItem
                          itemType="button"
                          key={placeKey(place)}
                          onSelect={() => handleVenueSelect(place)}
                          className="flex items-start gap-3 rounded-3xl p-2 cursor-pointer"
                        >
                          <div className="mt-1 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            {place.buildingId ? (
                              <Building2 className="h-4 w-4 text-primary" />
                            ) : (
                              <MapPin className="h-4 w-4 text-primary" />
                            )}
                          </div>
                          <div className="min-w-0 text-start">
                            <p className="font-medium truncate">{place.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {[
                                place.buildingName,
                                place.levelRef ?? "校園戶外",
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                  <CommandGroup heading={t("searchResults")}>
                    {suggestions.map((suggestion) => {
                      const Icon = getPlaceIcon(
                        suggestion.placeClass ?? undefined,
                        suggestion.placeType ?? undefined,
                      );
                      return (
                        <CommandItem
                          itemType="button"
                          onSelect={() => {
                            void handlePlaceClick(suggestion);
                          }}
                          key={suggestion.id}
                          disabled={pendingId !== null}
                          className="flex items-start gap-3 rounded-3xl p-2 cursor-pointer transition-colors"
                        >
                          <div className="mt-1 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                            {pendingId === suggestion.id ? (
                              <LoaderCircleIcon
                                size={16}
                                className="text-primary animate-spin"
                              />
                            ) : (
                              <Icon className="h-4 w-4 text-primary" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0 text-start">
                            <div className="flex items-center gap-1.5">
                              <p className="font-medium text-foreground truncate">
                                {suggestion.primaryText}
                              </p>
                              {suggestion.typeLabel && (
                                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full shrink-0">
                                  {suggestion.typeLabel}
                                </span>
                              )}
                            </div>
                            {suggestion.secondaryText && (
                              <p className="text-xs text-muted-foreground/70 truncate">
                                {suggestion.secondaryText}
                              </p>
                            )}
                            {suggestion.distanceMeters !== null && (
                              <p className="text-xs text-muted-foreground/70">
                                {formatDistance(suggestion.distanceMeters)}
                              </p>
                            )}
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                  {onSearchRequest && (
                    <CommandGroup>
                      <CommandItem
                        itemType="button"
                        onSelect={() => {
                          onSearchRequest(value as string);
                          setOpen(false);
                        }}
                        className="flex items-center gap-3 rounded-3xl p-2 cursor-pointer transition-colors"
                      >
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <SearchIcon size={16} className="text-primary" />
                        </div>
                        <span className="font-medium text-primary">
                          {t("searchForQuery", { query: value })}
                        </span>
                      </CommandItem>
                    </CommandGroup>
                  )}
                </>
              )}
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  );
}
export default PlaceInput;
