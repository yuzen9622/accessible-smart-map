"use client";

import { BookmarkIcon, ClockIcon, MicIcon } from "@animateicons/react/lucide";
import { Accessibility, Navigation, Pencil } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import WelcomeCard from "@/components/Onboarding/WelcomeCard";
import PlaceInput from "@/components/shared/PlaceInput";
import { useAppTranslation } from "@/i18n/client";
import { refreshVenuePlace } from "@/lib/indoor/catalog";
import { QUICK_ACTION_DEFS } from "@/lib/quickActions";
import { cn } from "@/lib/utils";
import useAuthStore from "@/stores/useAuthStore";
import useIndoorCatalog from "@/stores/useIndoorCatalog";
import useMapStore, { placeKey } from "@/stores/useMapStore";
import useQuickActionsStore from "@/stores/useQuickActionsStore";
import useVoiceStore from "@/stores/useVoiceStore";
import type { PlaceDetail } from "@/types";
import NearbyContextBlock from "./NearbyContextBlock";

export default function HomeContent() {
  const { t } = useAppTranslation();
  const {
    setSearchPlace,
    setInfoShow,
    map,
    searchHistory,
    setSheetMode,
    setActiveRailPanel,
    savedPlaces,
    pendingSearchQuery,
    setPendingSearchQuery,
    setPendingAiQuery,
    setChatOpen,
    a11yFilterEnabled,
    setA11yFilterEnabled,
  } = useMapStore(
    useShallow((s) => ({
      setSearchPlace: s.setSearchPlace,
      setInfoShow: s.setInfoShow,
      map: s.map,
      searchHistory: s.searchHistory,
      setSheetMode: s.setSheetMode,
      setActiveRailPanel: s.setActiveRailPanel,
      savedPlaces: s.savedPlaces,
      pendingSearchQuery: s.pendingSearchQuery,
      setPendingSearchQuery: s.setPendingSearchQuery,
      setPendingAiQuery: s.setPendingAiQuery,
      setChatOpen: s.setChatOpen,
      a11yFilterEnabled: s.a11yFilterEnabled,
      setA11yFilterEnabled: s.setA11yFilterEnabled,
    })),
  );
  const enabledActions = useQuickActionsStore((s) => s.enabledActions);
  const [input, setInput] = useState("");
  const router = useRouter();
  const pathname = usePathname();

  // Toggling writes `?a11y=1` back to the URL (dropped entirely when off,
  // not `?a11y=0`) so the filter state round-trips through a reload or a
  // shared link — ClientLayout is what reads it back on mount.
  const toggleA11yFilter = useCallback(() => {
    const next = !a11yFilterEnabled;
    setA11yFilterEnabled(next);
    const params = new URLSearchParams(window.location.search);
    if (next) params.set("a11y", "1");
    else params.delete("a11y");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [a11yFilterEnabled, setA11yFilterEnabled, router, pathname]);

  useEffect(() => {
    if (pendingSearchQuery) {
      setInput(pendingSearchQuery);
    }
  }, [pendingSearchQuery]);

  const handlePlaceChange = useCallback(
    (placeDetail: PlaceDetail) => {
      if (placeDetail.kind === "venue-place") {
        const catalog = useIndoorCatalog.getState();
        const current = refreshVenuePlace(catalog.models, placeDetail);
        if (!current) {
          toast.error("這個校園地點的資料已更新或尚未載入，請重新搜尋選取。");
          return;
        }
        setSearchPlace(current);
        setInput(current.name);
        setInfoShow({ ...current, isOpen: true });
        catalog.previewPlace(current);
        setSheetMode("place");
        return;
      }
      setSearchPlace(placeDetail);
      if (placeDetail.kind === "place") {
        const [lng, lat] = placeDetail.place.location.coordinates;
        setInput(placeDetail.place.name || placeDetail.place.fullAddress || "");
        setInfoShow({
          isOpen: true,
          kind: "place",
          place: placeDetail.place,
        });
        if (map)
          map.flyTo({
            center: [lng, lat],
          });
      } else if (placeDetail.kind === "coordinate") {
        setInput(placeDetail.address || "");
        setInfoShow({
          isOpen: true,
          kind: "coordinate",
          address: placeDetail.address,
          position: placeDetail.position,
        });
        if (map)
          map.flyTo({
            center: [placeDetail.position.lng, placeDetail.position.lat],
          });
      }
      setSheetMode("place");
    },
    [setSearchPlace, setInfoShow, map, setSheetMode],
  );

  // §S5 item 1: one input handles both place search and AI questions. A hit
  // in PlaceInput's own autocomplete always wins; this only fires when the
  // user submits a query search came up empty on.
  const handleAiQuery = useCallback(
    (query: string) => {
      setPendingAiQuery(query);
      setChatOpen(true);
      setInput("");
    },
    [setPendingAiQuery, setChatOpen],
  );

  const handleMicClick = useCallback(() => {
    if (!useAuthStore.getState().user) {
      toast.error(t("chatbot.voice.loginRequired", "請先登入才能使用語音對話"));
      return;
    }
    useVoiceStore.getState().setViewMode("panel");
    setChatOpen(true);
    useVoiceStore.getState().startSession();
  }, [setChatOpen, t]);

  return (
    <div className="space-y-5">
      <WelcomeCard />

      {/* Search — unified: place autocomplete or, when nothing matches and
          the text reads as a question, hands off to the AI assistant. Mic
          is a persistent second entry point into the same assistant. */}
      {/* 外框樣式由 PlaceInput 自己負責，避免與展開後的下拉面板產生兩層邊框／圓角 */}
      <div className="flex w-full items-center gap-2" data-coach="search">
        <div className="min-w-0 flex-1">
          <PlaceInput
            className="border-none"
            value={input}
            onChange={(e) => {
              setInput((e.target as HTMLInputElement).value);
              if (pendingSearchQuery) setPendingSearchQuery("");
            }}
            placeholder={t("searchPlaceHolder")}
            onPlaceSelect={handlePlaceChange}
            onAiQuery={handleAiQuery}
          />
        </div>
        <button
          type="button"
          onClick={handleMicClick}
          aria-label={t("chatbot.voice.micLabel", "語音對話")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border/50 bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent/40 hover:text-foreground"
        >
          <MicIcon size={16} />
        </button>
        {/* §6.1 of the UX audit: one global switch for "only show me
            accessible stuff", instead of the same concept living
            separately (and disagreeing) across a rail item, a route mode,
            and a place-detail section. Search results and route planning
            don't read this yet — that needs a backend filter param this
            app doesn't have (see PROJECTS.md) — today it flows into the AI
            assistant's system prompt (useAIChat.ts) and is shareable via
            `?a11y=1`. */}
        <button
          type="button"
          onClick={toggleA11yFilter}
          aria-pressed={a11yFilterEnabled}
          aria-label={t("a11yFilterToggle", "只顯示無障礙友善的地點與路線")}
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border shadow-sm transition-colors",
            a11yFilterEnabled
              ? "border-accessibility bg-accessibility/15 text-accessibility"
              : "border-border/50 bg-card text-muted-foreground hover:bg-accent/40 hover:text-foreground",
          )}
        >
          <Accessibility className="h-4 w-4" />
        </button>
      </div>

      {/* Route Planning Entry */}
      <button
        type="button"
        onClick={() => setSheetMode("plan")}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/5 hover:bg-primary/10 border border-primary/10 transition-colors text-left"
      >
        <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
          <Navigation className="h-4 w-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">{t("planRoute")}</p>
          <p className="text-xs text-muted-foreground">{t("planRouteDesc")}</p>
        </div>
      </button>

      {/* §S5 item 3: contextual "near you" — driven by the onboarding a11y
          profile, replaces having to pick a category before seeing anything
          useful. Renders nothing until there's a real nearby result. */}
      <NearbyContextBlock />

      {/* Quick actions — §S5 item 4: neutral chrome, colored icon only.
          Which ones show/their order used to only be reachable via Settings
          → 一般 (buried behind the account menu); the "編輯" button here jumps
          straight there instead. The heading row (and edit entry) stays
          visible even with zero enabled actions — otherwise turning every
          chip off from Settings would silently delete the only way back in. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
            {t("quickActions")}
          </h2>
          <button
            type="button"
            onClick={() => useAuthStore.getState().requestSettingsDialog()}
            className="flex min-h-11 items-center gap-1 rounded-full px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-accent/40 hover:text-foreground transition-colors"
          >
            <Pencil className="h-3 w-3" />
            {t("editQuickActions", "編輯")}
          </button>
        </div>
        {enabledActions.length > 0 && (
          /* Horizontal scroll strip: keeps the row to a single line on
             narrow screens instead of wrapping/overlapping neighbouring
             content, with snap points for a clean swipe stop. The right-edge
             fade + count are the only cue that there's more to scroll to —
             `no-scrollbar` hides the native scrollbar entirely, so without
             this a chip cut off mid-button (e.g. "公車到站" on a wide
             desktop panel) just looked truncated, not scrollable. */
          <div className="relative">
            <div className="flex gap-2 overflow-x-auto no-scrollbar snap-x snap-mandatory -mx-4 px-4 pb-0.5">
              {QUICK_ACTION_DEFS.filter((d) =>
                enabledActions.includes(d.id),
              ).map((def) => (
                <button
                  key={def.id}
                  type="button"
                  data-coach={def.id === "a11y" ? "a11y" : undefined}
                  onClick={() => setActiveRailPanel(def.id)}
                  className="flex items-center gap-1.5 min-h-11 px-3 py-2 rounded-full text-sm font-semibold bg-muted/60 text-foreground hover:bg-muted transition-colors shrink-0 snap-start"
                >
                  <def.Icon className={cn("h-4 w-4", def.iconClassName)} />
                  {t(def.labelKey)}
                </button>
              ))}
            </div>
            {/* Fade hint, not interactive — purely decorative so it must
                never intercept clicks meant for the chip underneath it. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent"
            />
          </div>
        )}
      </div>

      {/* Saved Places */}
      {savedPlaces.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
              <BookmarkIcon size={16} />
              {t("savedPlaces")}
            </h2>
            {savedPlaces.length > 3 && (
              <button
                type="button"
                onClick={() => setActiveRailPanel("saved")}
                className="text-xs text-primary hover:underline font-medium"
              >
                {t("viewAll")}
              </button>
            )}
          </div>
          <div className="space-y-1">
            {savedPlaces.slice(0, 5).map((item) => {
              const name =
                item.kind === "place"
                  ? item.place.name || item.place.fullAddress
                  : item.kind === "venue-place"
                    ? item.name
                    : item.address;
              return (
                <button
                  key={placeKey(item)}
                  type="button"
                  onClick={() => handlePlaceChange(item)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/60 transition-colors text-left"
                >
                  <BookmarkIcon size={16} className="text-primary shrink-0" />
                  <span className="min-w-0 text-sm">
                    <span className="block truncate">{name}</span>
                    {item.kind === "venue-place" && (
                      <span className="block text-xs text-muted-foreground truncate">
                        {[item.buildingName, item.levelRef]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Recent Searches */}
      {searchHistory.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
            <ClockIcon size={16} />
            {t("recentSearches")}
          </h2>
          <div className="space-y-1">
            {searchHistory.slice(0, 5).map((item) => {
              const name =
                item.kind === "place"
                  ? item.place.name || item.place.fullAddress
                  : item.kind === "venue-place"
                    ? item.name
                    : item.address;
              return (
                <button
                  key={placeKey(item)}
                  type="button"
                  onClick={() => handlePlaceChange(item)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/60 transition-colors text-left"
                >
                  <ClockIcon
                    size={16}
                    className="text-muted-foreground/50 shrink-0"
                  />
                  <span className="min-w-0 text-sm">
                    <span className="block truncate">{name}</span>
                    {item.kind === "venue-place" && (
                      <span className="block text-xs text-muted-foreground truncate">
                        {[item.buildingName, item.levelRef]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
