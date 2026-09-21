"use client";

import {
  ArrowDownUpIcon,
  MapPinIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  XIcon,
} from "@animateicons/react/lucide";
import {
  Accessibility,
  ArrowLeft,
  Bike,
  Bus,
  Car,
  EyeOff,
  Footprints,
  Loader2,
  Navigation,
  User,
} from "lucide-react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import PlaceInput from "@/components/shared/PlaceInput";
import useComputeRoute from "@/hook/useComputeRoute";
import { useAppTranslation } from "@/i18n/client";
import { cn } from "@/lib/utils";
import useMapStore from "@/stores/useMapStore";
import useOnboardingStore from "@/stores/useOnboardingStore";
import type { PlaceDetail } from "@/types";
import { Button } from "../ui/button";

const MAX_WAYPOINTS = 5;

interface WaypointRow {
  id: number;
  place: PlaceDetail | null;
  input: string;
}

const DISALLOWED_TRAVEL_MODES: Record<string, ("drive" | "motorcycle")[]> = {
  wheelchair: ["drive", "motorcycle"],
  visual_impaired: ["drive", "motorcycle"],
};

export default function RoutePlanContent() {
  const { t } = useAppTranslation();
  const {
    origin,
    destination,
    setOrigin,
    setDestination,
    originName,
    destinationName,
    setOriginName,
    setDestinationName,
    userLocation,
    setSheetMode,
    setSearchPlace,
    setPendingSearchQuery,
    setRouteSubPanel,
  } = useMapStore(
    useShallow((s) => ({
      origin: s.origin,
      destination: s.destination,
      setOrigin: s.setOrigin,
      setDestination: s.setDestination,
      originName: s.originName,
      destinationName: s.destinationName,
      setOriginName: s.setOriginName,
      setDestinationName: s.setDestinationName,
      userLocation: s.userLocation,
      setSheetMode: s.setSheetMode,
      setSearchPlace: s.setSearchPlace,
      setPendingSearchQuery: s.setPendingSearchQuery,
      setRouteSubPanel: s.setRouteSubPanel,
    })),
  );
  const { isLoading, handleComputeRoute } = useComputeRoute();

  const [originInput, setOriginInput] = useState(originName || "");
  const [destInput, setDestInput] = useState(destinationName || "");
  const [useMyLocation, setUseMyLocation] = useState(!origin);
  const [destEditing, setDestEditing] = useState(!destination);

  useEffect(() => {
    if (destination) setDestEditing(false);
  }, [destination]);
  const [travelMode, setTravelMode] = useState<
    "transit" | "drive" | "motorcycle" | "walk"
  >("transit");
  // Defaults to the onboarding profile's derived mode so the answers the user
  // already gave pay off immediately; still just a starting point — picking a
  // different pill here only changes this one route, it never writes back to
  // the profile. The lazy initializer covers the common case (this panel
  // mounts well after `ClientLayout` has already hydrated the store), but if
  // this ever renders in the very first commit — before that hydration
  // effect has run — the initializer would read the pre-hydration default.
  // The effect below re-syncs once hydration actually completes, unless the
  // user has already picked a pill by hand.
  const onboardingHydrated = useOnboardingStore((s) => s.hydrated);
  const [a11yMode, setA11yMode] = useState<
    "normal" | "wheelchair" | "elderly" | "visual_impaired"
  >(() => useOnboardingStore.getState().profile.routeMode);
  const userPickedModeRef = useRef(false);
  useEffect(() => {
    if (onboardingHydrated && !userPickedModeRef.current) {
      setA11yMode(useOnboardingStore.getState().profile.routeMode);
    }
  }, [onboardingHydrated]);
  const disabledTravelModes = DISALLOWED_TRAVEL_MODES[a11yMode] ?? [];
  useEffect(() => {
    const disallowed = DISALLOWED_TRAVEL_MODES[a11yMode] ?? [];
    if (disallowed.includes(travelMode as "drive" | "motorcycle")) {
      setTravelMode("transit");
    }
  }, [a11yMode, travelMode]);
  const [waypointRows, setWaypointRows] = useState<WaypointRow[]>([]);
  const nextWaypointId = useRef(0);

  useEffect(() => {
    setOriginInput(originName || "");
  }, [originName]);

  useEffect(() => {
    setDestInput(destinationName || "");
  }, [destinationName]);

  const handleOriginSelect = useCallback(
    (place: PlaceDetail) => {
      if (place.kind === "coordinate" && place.address === "你的位置") {
        setOrigin(null);
        setOriginName("");
        setOriginInput("");
        setUseMyLocation(true);
        return;
      }
      setOrigin(place);
      const name =
        place.kind === "place"
          ? place.place.name || place.place.fullAddress || ""
          : place.address || "";
      setOriginName(name);
      setOriginInput(name);
      setUseMyLocation(false);
    },
    [setOrigin, setOriginName],
  );

  const handleDestSelect = useCallback(
    (place: PlaceDetail) => {
      setDestination(place);
      const name =
        place.kind === "place"
          ? place.place.name || place.place.fullAddress || ""
          : place.address || "";
      setDestinationName(name);
      setDestInput(name);
      setDestEditing(false);
    },
    [setDestination, setDestinationName],
  );

  const handleClearDest = useCallback(() => {
    setDestination(null);
    setDestinationName("");
    setDestInput("");
    setDestEditing(true);
  }, [setDestination, setDestinationName]);

  const handleSearchRequest = useCallback(
    (query: string) => {
      setPendingSearchQuery(query);
      setSheetMode("home");
    },
    [setPendingSearchQuery, setSheetMode],
  );

  const handleWaypointSelect = useCallback(
    (index: number, place: PlaceDetail) => {
      const name =
        place.kind === "place"
          ? place.place.name || place.place.fullAddress || ""
          : place.address || "";
      setWaypointRows((rows) =>
        rows.map((r, i) => (i === index ? { ...r, place, input: name } : r)),
      );
    },
    [],
  );

  const handleWaypointInputChange = useCallback(
    (index: number, value: string) => {
      setWaypointRows((rows) =>
        rows.map((r, i) =>
          i === index ? { ...r, place: null, input: value } : r,
        ),
      );
    },
    [],
  );

  const handleRemoveWaypoint = useCallback((index: number) => {
    setWaypointRows((rows) => rows.filter((_, i) => i !== index));
  }, []);

  const handleAddWaypointRow = useCallback(() => {
    setWaypointRows((rows) =>
      rows.length >= MAX_WAYPOINTS
        ? rows
        : [...rows, { id: nextWaypointId.current++, place: null, input: "" }],
    );
  }, []);

  const handleUseMyLocation = useCallback(() => {
    setOrigin(null);
    setOriginName("");
    setOriginInput("");
    setUseMyLocation(true);
  }, [setOrigin, setOriginName]);

  const handleSwap = useCallback(() => {
    const tmpOrigin = origin;
    const tmpOriginName = originName;
    const tmpUseMyLoc = useMyLocation;

    if (destination) {
      if (
        destination.kind === "coordinate" &&
        destination.address === "你的位置"
      ) {
        setOrigin(null);
        setOriginName("");
        setOriginInput("");
        setUseMyLocation(true);
      } else {
        setOrigin(destination);
        setOriginName(destinationName);
        setOriginInput(destinationName);
        setUseMyLocation(false);
      }
    } else {
      setOrigin(null);
      setOriginName("");
      setOriginInput("");
    }

    if (tmpUseMyLoc) {
      setDestination(null);
      setDestinationName("");
      setDestInput("");
    } else if (tmpOrigin) {
      setDestination(tmpOrigin);
      setDestinationName(tmpOriginName);
      setDestInput(tmpOriginName);
    }
  }, [
    origin,
    destination,
    originName,
    destinationName,
    useMyLocation,
    setOrigin,
    setDestination,
    setOriginName,
    setDestinationName,
  ]);

  const canStart =
    (useMyLocation ? !!userLocation : !!origin?.position) &&
    !!destination?.position;

  const handleStartRoute = useCallback(async () => {
    if (isLoading) return;
    if (!canStart) {
      if (!destination?.position) {
        toast.error(
          destInput.trim()
            ? t("selectDestinationFromSuggestions")
            : t("chooseDestination"),
        );
      } else if (useMyLocation && !userLocation) {
        toast.error(t("enableLocationOrEnterOrigin"));
      } else if (!useMyLocation && !origin?.position) {
        toast.error(
          originInput.trim()
            ? t("selectOriginFromSuggestions")
            : t("chooseOrigin"),
        );
      }
      return;
    }

    const unresolvedWaypoint = waypointRows.find(
      (r) => r.input.trim() && !r.place,
    );
    if (unresolvedWaypoint) {
      toast.error(t("selectWaypointFromSuggestions"));
      return;
    }

    const originPos = useMyLocation ? userLocation : (origin?.position ?? null);
    const destPos = destination?.position ?? null;
    if (!originPos || !destPos) return;

    const waypoints = waypointRows
      .map((r) => r.place?.position)
      .filter((position): position is NonNullable<typeof position> =>
        Boolean(position),
      );

    const success = await handleComputeRoute({
      origin: originPos,
      destination: destPos,
      waypoints: waypoints.length ? waypoints : undefined,
      mode: a11yMode,
      travelMode,
    });
    if (success) {
      setSearchPlace(null);
      // A fresh result set starts on the plain route list, never on whichever
      // sub-page the user last opened from a previous plan.
      setRouteSubPanel("none");
      setSheetMode("route");
    }
  }, [
    isLoading,
    canStart,
    useMyLocation,
    userLocation,
    origin,
    originInput,
    destination,
    destInput,
    waypointRows,
    handleComputeRoute,
    setSearchPlace,
    setRouteSubPanel,
    setSheetMode,
    t,
    travelMode,
    a11yMode,
  ]);

  const handleBack = useCallback(() => {
    setSheetMode("home");
  }, [setSheetMode]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleBack}
          aria-label={t("back")}
          className="relative h-8 w-8 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted transition-colors shrink-0 after:absolute after:inset-[-6px] after:content-['']"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-lg font-bold">{t("planRoute")}</h1>
      </div>

      {/* Origin / Destination — Gaode-style card */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-visible">
        <div className="flex">
          {/* Left: colored dots + line */}
          <div className="flex flex-col items-center py-4 px-3">
            <div className="h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20 shrink-0" />
            {waypointRows.map((row) => (
              <Fragment key={row.id}>
                <div className="flex-1 w-px bg-border my-1 min-h-[20px]" />
                <div className="h-2.5 w-2.5 rounded-full bg-blue-500 ring-2 ring-blue-500/20 shrink-0" />
              </Fragment>
            ))}
            <div className="flex-1 w-px bg-border my-1 min-h-[20px]" />
            <div className="h-3 w-3 rounded-full bg-red-500 ring-2 ring-red-500/20 shrink-0" />
          </div>

          {/* Right: input fields */}
          <div className="flex-1 min-w-0 py-1">
            {/* Origin input */}
            <div className="relative overflow-visible">
              {useMyLocation ? (
                <button
                  type="button"
                  onClick={() => setUseMyLocation(false)}
                  className="w-full flex items-center gap-2 px-2 py-3 text-sm text-left"
                >
                  <Navigation className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                    {t("myLocation")}
                  </span>
                </button>
              ) : (
                <PlaceInput
                  hideIcon
                  className="border-none shadow-none text-sm h-11"
                  value={originInput}
                  onChange={(e) =>
                    setOriginInput((e.target as HTMLInputElement).value)
                  }
                  placeholder={t("chooseOrigin")}
                  onPlaceSelect={handleOriginSelect}
                />
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-border/60 mx-1" />

            {/* Waypoint inputs */}
            {waypointRows.map((row, index) => (
              <Fragment key={row.id}>
                <div className="relative overflow-visible flex items-center gap-1">
                  <div className="flex-1 min-w-0">
                    <PlaceInput
                      hideIcon
                      className="border-none shadow-none text-sm h-11"
                      value={row.input}
                      onChange={(e) =>
                        handleWaypointInputChange(
                          index,
                          (e.target as HTMLInputElement).value,
                        )
                      }
                      placeholder={t("chooseWaypoint")}
                      onPlaceSelect={(place) =>
                        handleWaypointSelect(index, place)
                      }
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveWaypoint(index)}
                    aria-label={t("removeWaypoint")}
                    className="h-7 w-7 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted transition-colors shrink-0 mr-1"
                  >
                    <XIcon size={14} className="text-muted-foreground" />
                  </button>
                </div>
                <div className="border-t border-border/60 mx-1" />
              </Fragment>
            ))}

            {/* Destination — three states: chip / search prompt / manual input */}
            <div className="relative overflow-visible">
              {destination && !destEditing ? (
                <div className="flex items-center gap-2 px-2 py-2.5 min-h-[44px]">
                  <MapPinIcon size={16} className="text-red-500 shrink-0" />
                  <button
                    type="button"
                    onClick={() => setDestEditing(true)}
                    aria-label={t("editDestination", "編輯目的地")}
                    className="flex-1 min-w-0 text-left"
                  >
                    <span className="text-sm font-medium truncate block">
                      {destinationName}
                    </span>
                    {destination.kind === "place" &&
                      destination.place.fullAddress &&
                      destination.place.fullAddress !== destinationName && (
                        <span className="text-xs text-muted-foreground truncate block">
                          {destination.place.fullAddress}
                        </span>
                      )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDestEditing(true)}
                    aria-label={t("editDestination", "編輯目的地")}
                    className="relative h-7 w-7 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted transition-colors shrink-0 after:absolute after:inset-[-8px] after:content-['']"
                  >
                    <PencilIcon size={12} className="text-muted-foreground" />
                  </button>
                  <button
                    type="button"
                    onClick={handleClearDest}
                    aria-label={t("clearDestination", "清除目的地")}
                    className="relative h-7 w-7 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted transition-colors shrink-0 after:absolute after:inset-[-8px] after:content-['']"
                  >
                    <XIcon size={12} className="text-muted-foreground" />
                  </button>
                </div>
              ) : (
                <PlaceInput
                  hideIcon
                  className="border-none shadow-none text-sm h-11"
                  value={destInput}
                  onChange={(e) =>
                    setDestInput((e.target as HTMLInputElement).value)
                  }
                  placeholder={t("searchOrInputDest", "搜尋或輸入目的地")}
                  onPlaceSelect={handleDestSelect}
                  onSearchRequest={handleSearchRequest}
                />
              )}
            </div>
          </div>

          {/* Swap button */}
          <div className="flex items-center px-2">
            <button
              type="button"
              onClick={handleSwap}
              className="h-9 w-9 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted transition-colors"
            >
              <ArrowDownUpIcon size={16} className="text-muted-foreground" />
            </button>
          </div>
        </div>
      </div>

      {/* Add waypoint */}
      {waypointRows.length < MAX_WAYPOINTS && (
        <button
          type="button"
          onClick={handleAddWaypointRow}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-muted-foreground hover:bg-muted/40 transition-colors w-full"
        >
          <PlusIcon size={16} />
          {t("addWaypoint")}
        </button>
      )}

      {/* My Location shortcut */}
      {!useMyLocation && (
        <button
          type="button"
          onClick={handleUseMyLocation}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/5 transition-colors w-full"
        >
          <Navigation className="h-4 w-4" />
          {t("useMyLocationAsOrigin")}
        </button>
      )}

      {/* Modes Selection */}
      <div className="flex flex-col gap-3 py-2">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-muted-foreground ml-1">
            {t("transportTool")}
          </span>
          <div className="flex gap-1 bg-muted/30 p-1 rounded-2xl w-full overflow-x-auto no-scrollbar">
            {[
              {
                id: "transit" as const,
                icon: Bus,
                label: t("transit", "大眾運輸"),
              },
              { id: "drive" as const, icon: Car, label: t("drive", "開車") },
              {
                id: "motorcycle" as const,
                icon: Bike,
                label: t("motorcycle", "機車"),
              },
              {
                id: "walk" as const,
                icon: Footprints,
                label: t("walk", "步行"),
              },
            ].map((tm) => {
              const isDisallowed = disabledTravelModes.includes(
                tm.id as "drive" | "motorcycle",
              );
              return (
                <Button
                  key={tm.id}
                  variant={travelMode === tm.id ? "default" : "ghost"}
                  size="sm"
                  disabled={isDisallowed}
                  aria-disabled={isDisallowed}
                  className={cn(
                    "flex-1 h-10 px-3 rounded-xl text-xs flex flex-col items-center justify-center gap-1 transition-all",
                    travelMode === tm.id
                      ? "shadow-sm"
                      : "text-muted-foreground hover:bg-muted/80",
                  )}
                  onClick={() => setTravelMode(tm.id)}
                  aria-label={
                    isDisallowed
                      ? t("travelModeUnavailableFor", {
                          mode: tm.label,
                          a11yMode: t(
                            a11yMode === "wheelchair"
                              ? "wheelchairMode"
                              : "visualImpairedMode",
                          ),
                          defaultValue: "{{a11yMode}}模式不支援{{mode}}",
                        })
                      : tm.label
                  }
                >
                  <tm.icon className="h-4 w-4" />
                  <span className="text-xs">{tm.label}</span>
                </Button>
              );
            })}
          </div>
          {disabledTravelModes.length > 0 && (
            <p className="text-xs text-muted-foreground ml-1">
              {t("travelModeGatedHint", {
                a11yMode: t(
                  a11yMode === "wheelchair"
                    ? "wheelchairMode"
                    : "visualImpairedMode",
                ),
                defaultValue: "{{a11yMode}}模式已停用不適用的交通方式",
              })}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-muted-foreground ml-1">
            {t("a11yModeLabel")}
          </span>
          <div className="flex gap-1 bg-muted/30 p-1 rounded-2xl w-full overflow-x-auto no-scrollbar">
            {[
              {
                id: "normal" as const,
                icon: User,
                label: t("normalMode", "一般"),
              },
              {
                id: "wheelchair" as const,
                icon: Accessibility,
                label: t("wheelchairMode", "輪椅"),
              },
              {
                id: "elderly" as const,
                icon: User,
                label: t("elderlyMode", "長者"),
              },
              {
                id: "visual_impaired" as const,
                icon: EyeOff,
                label: t("visualImpairedMode", "視障"),
              },
            ].map((am) => (
              <Button
                key={am.id}
                variant={a11yMode === am.id ? "default" : "ghost"}
                size="sm"
                className={cn(
                  "flex-1 h-10 px-3 rounded-xl text-xs flex flex-col items-center justify-center gap-1 transition-all",
                  a11yMode === am.id
                    ? "shadow-sm"
                    : "text-muted-foreground hover:bg-muted/80",
                )}
                onClick={() => {
                  userPickedModeRef.current = true;
                  setA11yMode(am.id);
                }}
                aria-label={am.label}
              >
                <am.icon className="h-4 w-4" />
                <span className="text-xs">{am.label}</span>
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Start Route */}
      <Button
        onClick={handleStartRoute}
        disabled={isLoading}
        aria-disabled={!canStart}
        className={`w-full rounded-xl h-12 text-base gap-2 ${
          !canStart ? "opacity-50" : ""
        }`}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            {t("loadingRoute")}
          </>
        ) : (
          <>
            <SearchIcon size={20} />
            {t("searchRoute")}
          </>
        )}
      </Button>
    </div>
  );
}
