"use client";

import { Bus, ChevronLeft, Loader2, MapPin, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import useBusSearch, { type BusSearchMode } from "@/hook/useBusSearch";
import { useAppTranslation } from "@/i18n/client";
import { getAppLanguage } from "@/i18n/language";
import {
  getBusRouteDetail,
  getNearbyBusStops,
  type RouteDetailDirection,
  type RouteDetailStop,
  searchBusRoutes,
  searchBusStops,
} from "@/lib/api/transit";
import { nonemptyName } from "@/lib/route/sourceNames";
import {
  type BusDirectionSelection,
  busDirectionLabel,
  busDirectionOptions,
  selectBusDirection,
} from "@/lib/transit/busDirections";
import { parseStatusLabel } from "@/lib/transit/busLegStops";
import useMapStore from "@/stores/useMapStore";
import type { BusSearchResult, BusStopSearchResult } from "@/types/transit";
import { Badge } from "../ui/badge";
import { Command, CommandGroup, CommandItem, CommandList } from "../ui/command";

type Language = "en" | "zh-TW";
type Localized<T> = T & { displayLanguage?: Language };
const name = (display?: string, canonical?: string) =>
  nonemptyName(display) || nonemptyName(canonical) || "";
function stopRouteNames(stop: BusStopSearchResult, localized = true) {
  return (stop.routes ?? []).map((route, index) =>
    name(localized ? stop.routeDisplayNames?.[index] : undefined, route),
  );
}

const CityNameMap: Record<string, string> = {
  Taipei: "台北市",
  NewTaipei: "新北市",
  Taoyuan: "桃園市",
  Taichung: "台中市",
  Tainan: "台南市",
  Kaohsiung: "高雄市",
  Keelung: "基隆市",
  Hsinchu: "新竹市",
  HsinchuCounty: "新竹縣",
  MiaoliCounty: "苗栗縣",
  ChanghuaCounty: "彰化縣",
  NantouCounty: "南投縣",
  YunlinCounty: "雲林縣",
  ChiayiCounty: "嘉義縣",
  Chiayi: "嘉義市",
  PingtungCounty: "屏東縣",
  YilanCounty: "宜蘭縣",
  HualienCounty: "花蓮縣",
  TaitungCounty: "台東縣",
  KinmenCounty: "金門縣",
  PenghuCounty: "澎湖縣",
  LienchiangCounty: "連江縣",
  InterCity: "公路公車",
};

export function RouteStopCard({
  stop,
  isSelected,
  onSelect,
}: {
  stop: RouteDetailStop;
  isSelected?: boolean;
  onSelect?: () => void;
}) {
  const { t } = useAppTranslation();
  const hasEstimate =
    typeof stop.estimateMinutes === "number" &&
    Number.isFinite(stop.estimateMinutes) &&
    stop.estimateMinutes >= 0;
  const isArrivingSoon =
    hasEstimate &&
    typeof stop.estimateMinutes === "number" &&
    stop.estimateMinutes < 3;

  const status = stop.statusLabel?.trim() ?? "";
  const parsedStatus = parseStatusLabel(status);
  let badgeText = parsedStatus?.key
    ? t(parsedStatus.key, parsedStatus.params)
    : !status || status === "正常" || status === "暫無到站資訊"
      ? t("busArrivalUnavailable")
      : status;
  if (parsedStatus?.kind === "scheduled") {
    badgeText = t("busPlannedAt", { time: badgeText });
  }
  let badgeColor = "text-muted-foreground bg-muted/60";

  if (hasEstimate && typeof stop.estimateMinutes === "number") {
    if (isArrivingSoon) {
      badgeText = t(
        stop.estimateMinutes === 0 ? "busArrivalArriving" : "busArrivalSoon",
      );
      badgeColor =
        "text-red-600 bg-red-500/10 font-bold border border-red-500/20 shadow-sm";
    } else {
      badgeText = t("minutesAway", { minutes: stop.estimateMinutes });
      badgeColor = "text-emerald-600 bg-emerald-500/10";
    }
  }

  return (
    <li className="list-none">
      <button
        type="button"
        onClick={onSelect}
        className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
          isSelected
            ? "bg-emerald-500/10 border-emerald-500/50 shadow-sm"
            : "bg-muted/40 border-border/30 hover:bg-muted/70"
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold truncate flex-1">
            {name(stop.displayName, stop.name)}
          </p>
          <Badge
            variant="secondary"
            className={`text-xs shrink-0 ${badgeColor}`}
          >
            {badgeText}
          </Badge>
        </div>
      </button>
    </li>
  );
}

export default function BusPanel({
  onClose,
  hideHeader,
}: {
  onClose: () => void;
  hideHeader?: boolean;
}) {
  const { t } = useAppTranslation();
  const lang = getAppLanguage();
  const [mode, setMode] = useState<BusSearchMode>("route");
  const [keyword, setKeyword] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    userLocation,
    map,
    setNearbyBusStops,
    setBusRouteStops,
    selectedBusStop,
    setSelectedBusStop,
  } = useMapStore(
    useShallow((s) => ({
      userLocation: s.userLocation,
      map: s.map,
      setNearbyBusStops: s.setNearbyBusStops,
      setBusRouteStops: s.setBusRouteStops,
      selectedBusStop: s.selectedBusStop,
      setSelectedBusStop: s.setSelectedBusStop,
    })),
  );
  const [nearbyStops, setNearbyStops] = useState<
    (BusStopSearchResult & { distance?: number })[]
  >([]);
  const [nearbyLanguage, setNearbyLanguage] = useState<Language | null>(null);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setNearbyStops([]);
    setNearbyBusStops([]);
    const fetchNearby = async () => {
      if (!userLocation) return;
      setNearbyLoading(true);
      setNearbyError(null);
      try {
        const res = await getNearbyBusStops(
          userLocation.lat,
          userLocation.lng,
          lang,
        );
        if (active) {
          if (res.ok && res.data?.stops) {
            setNearbyLanguage(lang);
            setNearbyStops(res.data.stops);
            setNearbyBusStops(res.data.stops);
          } else {
            setNearbyError("無法載入附近站牌");
          }
        }
      } catch {
        if (active) {
          setNearbyError("載入附近站牌時發生錯誤");
        }
      } finally {
        if (active) {
          setNearbyLoading(false);
        }
      }
    };

    if (!userLocation) {
      setNearbyStops([]);
      setNearbyError(null);
      return;
    }

    // fetch nearby stops when location is available and no query is active
    fetchNearby();

    return () => {
      active = false;
    };
  }, [userLocation, setNearbyBusStops, lang]);

  const { results, loading: searchLoading } = useBusSearch(
    keyword,
    mode,
    userLocation,
  );

  const routeResults = useMemo(
    () =>
      mode === "route"
        ? (results.filter((r): r is BusSearchResult =>
            Boolean(
              r &&
                typeof r === "object" &&
                "routeName" in r &&
                !("stopUid" in r),
            ),
          ) as BusSearchResult[])
        : [],
    [results, mode],
  );
  const stopResults = useMemo(
    () =>
      mode === "stop"
        ? (results.filter((r): r is BusStopSearchResult =>
            Boolean(r && typeof r === "object" && "stopUid" in r),
          ) as BusStopSearchResult[])
        : [],
    [results, mode],
  );

  const groupedResults = useMemo(() => {
    if (!routeResults.length) return {};
    return routeResults.reduce(
      (acc, curr) => {
        const city = CityNameMap[curr.city] || curr.city;
        if (!acc[city]) acc[city] = [];
        acc[city].push(curr);
        return acc;
      },
      {} as Record<string, BusSearchResult[]>,
    );
  }, [routeResults]);

  const groupedStops = useMemo(() => {
    if (!stopResults.length) return {};
    return stopResults.reduce(
      (acc, curr) => {
        const city = CityNameMap[curr.city] || curr.city;
        if (!acc[city]) acc[city] = [];
        acc[city].push(curr);
        return acc;
      },
      {} as Record<string, BusStopSearchResult[]>,
    );
  }, [stopResults]);

  const [selectedRoute, setSelectedRoute] =
    useState<Localized<BusSearchResult> | null>(null);
  const [selectedStop, setSelectedStop] =
    useState<Localized<BusStopSearchResult> | null>(null);
  const [selection, setSelection] = useState<BusDirectionSelection | null>(
    null,
  );
  const [routeDetails, setRouteDetails] = useState<RouteDetailDirection[]>([]);
  const [detailsLanguage, setDetailsLanguage] = useState<Language | null>(null);
  const [routeDisplayName, setRouteDisplayName] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const REFRESH_INTERVAL = 30;
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL);
  const selectedRouteName = selectedRoute?.routeName;
  const selectedRouteCity = selectedRoute?.city;

  useEffect(() => {
    if (!selectedRouteName || !selectedRouteCity) return;
    let active = true;
    setRouteDetails([]);
    setRouteDisplayName(undefined);
    let pending = false;
    let remaining = REFRESH_INTERVAL;
    let request: AbortController | undefined;
    const refresh = async (background = false) => {
      if (pending) return;
      pending = true;
      request = new AbortController();
      if (!background) setLoading(true);
      // A new receipt is only established by a successful response. Expired
      // snapshots keep the published sequence but never a permanent zero ETA.
      if (background) {
        setRouteDetails((details) =>
          details.map((detail) => ({
            ...detail,
            stops: detail.stops.map((stop) => ({
              ...stop,
              estimateMinutes: null,
              statusLabel: "",
            })),
          })),
        );
      }
      setError(null);
      try {
        const res = await getBusRouteDetail(
          selectedRouteName,
          selectedRouteCity,
          undefined,
          request.signal,
          undefined,
          lang,
        );
        if (!active) return;
        if ((res.ok || res.success) && res.data?.directions) {
          const details = res.data.directions;
          setDetailsLanguage(lang);
          setRouteDisplayName(res.data.routeDisplayName);
          setRouteDetails(details);
          setSelection((previous) =>
            selectBusDirection(busDirectionOptions(details), previous),
          );
          if (!details.length) setError(t("noBusData"));
        } else {
          setRouteDetails([]);
          setError(res.message || t("noBusData"));
        }
      } catch (err) {
        if (!active) return;
        setRouteDetails([]);
        setError(err instanceof Error ? err.message : t("networkError"));
      } finally {
        if (active) {
          pending = false;
          setLoading(false);
          remaining = REFRESH_INTERVAL;
          setCountdown(remaining);
        }
      }
    };
    void refresh();
    const intervalId = setInterval(() => {
      if (pending) return;
      remaining -= 1;
      setCountdown(remaining);
      if (remaining <= 0) void refresh(true);
    }, 1000);
    const onResume = () => {
      if (document.visibilityState === "visible") void refresh(true);
    };
    document.addEventListener("visibilitychange", onResume);
    return () => {
      active = false;
      request?.abort();
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [selectedRouteName, selectedRouteCity, t, lang]);

  const directionOptions = busDirectionOptions(
    detailsLanguage === lang ? routeDetails : [],
  );
  const currentDirectionDetails = directionOptions.find(
    (option) => option.key === selection?.key,
  )?.detail;
  const directionLabel = (detail: RouteDetailDirection) => {
    const semanticLabel = t(busDirectionLabel(detail.direction));
    const terminalStop = detail.stops.at(-1);
    const terminal =
      name(detail.toDisplayName, detail.to) ||
      name(terminalStop?.displayName, terminalStop?.name) ||
      (detail.direction === 0
        ? name(
            selectedRoute?.displayLanguage === lang
              ? selectedRoute.destinationDisplayName
              : undefined,
            selectedRoute?.destination,
          )
        : name(
            selectedRoute?.displayLanguage === lang
              ? selectedRoute.departureDisplayName
              : undefined,
            selectedRoute?.departure,
          ));
    const label =
      (detail.direction === 0 || detail.direction === 1) && terminal
        ? t("busTowards", { destination: terminal })
        : semanticLabel;
    const branch = name(detail.subRouteDisplayName, detail.subRouteName);
    return branch ? `${branch} · ${label}` : label;
  };

  useEffect(() => {
    if (mode === "stop" && stopResults.length > 0) {
      setNearbyBusStops(stopResults);
    } else if (mode === "route" && !selectedRoute) {
      setNearbyBusStops(nearbyLanguage === lang ? nearbyStops : []);
    }
  }, [
    mode,
    stopResults,
    selectedRoute,
    nearbyStops,
    nearbyLanguage,
    lang,
    setNearbyBusStops,
  ]);

  useEffect(() => {
    setBusRouteStops(
      currentDirectionDetails?.stops ?? [],
      currentDirectionDetails?.polyline,
    );
  }, [currentDirectionDetails, setBusRouteStops]);

  useEffect(
    () => () => {
      setBusRouteStops([]);
      setSelectedBusStop(null);
    },
    [setBusRouteStops, setSelectedBusStop],
  );

  useEffect(() => {
    if (selection?.key) setSelectedBusStop(null);
  }, [selection?.key, setSelectedBusStop]);

  const selectedStopUid = selectedStop?.stopUid;
  const selectedStopName = selectedStop?.stopName;
  const selectedStopCity = selectedStop?.city;
  useEffect(() => {
    let active = true;
    if (selectedRouteName && selectedRouteCity) {
      void searchBusRoutes(selectedRouteName, undefined, lang)
        .then((res) => {
          if (!active) return;
          const match = res.data?.routes?.find(
            (route) =>
              route.routeName === selectedRouteName &&
              route.city === selectedRouteCity,
          );
          if (match)
            setSelectedRoute((old) =>
              old
                ? {
                    ...old,
                    routeDisplayName: match.routeDisplayName,
                    departureDisplayName: match.departureDisplayName,
                    destinationDisplayName: match.destinationDisplayName,
                    displayLanguage: lang,
                  }
                : old,
            );
        })
        .catch(() => {});
    }
    if (selectedStopUid && selectedStopName) {
      void searchBusStops(selectedStopName, undefined, lang)
        .then((res) => {
          if (!active) return;
          const match = res.data?.stops?.find(
            (stop) =>
              stop.stopUid === selectedStopUid &&
              stop.city === selectedStopCity,
          );
          if (match)
            setSelectedStop((old) =>
              old
                ? {
                    ...old,
                    stopDisplayName: match.stopDisplayName,
                    routeDisplayNames: match.routeDisplayNames,
                    displayLanguage: lang,
                  }
                : old,
            );
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [
    selectedRouteName,
    selectedRouteCity,
    selectedStopUid,
    selectedStopName,
    selectedStopCity,
    lang,
  ]);

  const handleRouteSelect = (route: BusSearchResult) => {
    setSelectedRoute({ ...route, displayLanguage: lang });
    setOpen(false);
    setKeyword("");
    setSelection(null);
    setSelectedBusStop(null);
    setBusRouteStops([]);
    setRouteDetails([]);
    setError(null);
    setCountdown(REFRESH_INTERVAL);
  };

  const resetSelection = () => {
    setSelectedRoute(null);
    setSelection(null);
    setRouteDetails([]);
    setBusRouteStops([]);
    setSelectedBusStop(null);
    setNearbyBusStops(nearbyStops);
    setError(null);
    setTimeout(() => {
      inputRef.current?.focus();
      setOpen(true);
    }, 100);
  };

  const handleStopSelect = (stop: BusStopSearchResult) => {
    setSelectedStop({ ...stop, displayLanguage: lang });
    setSelectedBusStop(stop);
    setOpen(false);
    setKeyword("");
    if (map) {
      map.flyTo({
        center: [stop.coordinates[0], stop.coordinates[1]],
        zoom: 17,
      });
    }
  };

  const backToSearch = () => {
    setSelectedStop(null);
    setSelectedBusStop(null);
    setNearbyBusStops(nearbyStops);
    setTimeout(() => {
      inputRef.current?.focus();
      setOpen(true);
    }, 100);
  };

  // Open the existing route-detail flow from a stop's route list. We only have
  // the route name + city here (no departure/destination), so synthesize a
  // BusSearchResult; the direction labels fall back to route-detail terminals.
  const handleStopRouteSelect = (routeName: string, city: string) => {
    setSelectedStop(null);
    setSelectedRoute({ routeName, city, departure: "", destination: "" });
    setSelection(null);
    setRouteDetails([]);
    setBusRouteStops([]);
    setError(null);
    setCountdown(REFRESH_INTERVAL);
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {!hideHeader && (
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold flex items-center gap-2">
            <Bus className="h-4.5 w-4.5 text-emerald-500" />
            {t("busInfo")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="h-7 w-7 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted"
            aria-label={t("close")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {selectedRoute ? (
        <div className="flex flex-col flex-1 min-h-0 space-y-4 animate-in fade-in slide-in-from-right-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetSelection}
              className="h-8 w-8 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div>
              <h3 className="font-bold text-lg leading-tight">
                {name(
                  detailsLanguage === lang ? routeDisplayName : undefined,
                  name(
                    selectedRoute.displayLanguage === lang
                      ? selectedRoute.routeDisplayName
                      : undefined,
                    selectedRoute.routeName,
                  ),
                )}
              </h3>
              <p className="text-xs text-muted-foreground">
                {CityNameMap[selectedRoute.city] || selectedRoute.city}
              </p>
            </div>
          </div>

          {selection !== null && directionOptions.length > 0 && (
            <div className="space-y-3">
              <fieldset className="flex flex-wrap gap-1 rounded-lg bg-muted/60 border border-border/30 p-0.5 text-sm">
                <legend className="sr-only">
                  {t("busDirectionSelection")}
                </legend>
                {directionOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={selection.key === option.key}
                    onClick={() => {
                      setSelectedBusStop(null);
                      setSelection({
                        key: option.key,
                        subRouteUid: option.subRouteUid,
                        subRouteName: option.subRouteName,
                      });
                    }}
                    className={`flex-1 min-h-11 px-3 py-1.5 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                      selection.key === option.key
                        ? "bg-background shadow-sm text-foreground font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {directionLabel(option.detail)}
                  </button>
                ))}
              </fieldset>

              {/* Progress bar countdown */}
              {!loading && !error && (
                <div className="flex items-center gap-2 px-1">
                  <div className="w-full h-1.5 bg-muted/60 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-500/80 transition-all duration-1000 ease-linear rounded-full"
                      style={{
                        width: `${(countdown / REFRESH_INTERVAL) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap w-8 text-right font-medium">
                    {countdown}s
                  </span>
                </div>
              )}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
            </div>
          ) : error ? (
            <div className="text-center py-8 space-y-2">
              <Bus className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          ) : currentDirectionDetails?.stops ? (
            <ul className="space-y-2 flex-1 overflow-y-auto pr-2 pb-4">
              {currentDirectionDetails.stops.map((stop) => (
                <RouteStopCard
                  key={`${stop.seq}-${stop.name}`}
                  stop={stop}
                  isSelected={
                    (selectedBusStop as RouteDetailStop)?.seq === stop.seq &&
                    (selectedBusStop as RouteDetailStop)?.name === stop.name
                  }
                  onSelect={() => {
                    setSelectedBusStop(stop);
                    if (map) {
                      map.flyTo({ center: [stop.lng, stop.lat], zoom: 17 });
                    }
                  }}
                />
              ))}
            </ul>
          ) : null}
        </div>
      ) : selectedStop ? (
        <div className="flex flex-col flex-1 min-h-0 space-y-4 animate-in fade-in slide-in-from-right-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={backToSearch}
              className="h-8 w-8 rounded-full bg-muted/60 flex items-center justify-center hover:bg-muted"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 min-w-0">
              <MapPin className="h-4.5 w-4.5 text-emerald-500 shrink-0" />
              <div className="min-w-0">
                <h3 className="font-bold text-lg leading-tight truncate">
                  {name(
                    selectedStop.displayLanguage === lang
                      ? selectedStop.stopDisplayName
                      : undefined,
                    selectedStop.stopName,
                  )}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {CityNameMap[selectedStop.city] || selectedStop.city}
                </p>
              </div>
            </div>
          </div>

          {!selectedStop.routes || selectedStop.routes.length === 0 ? (
            <div className="text-center py-8 space-y-2">
              <Bus className="h-8 w-8 mx-auto text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">此站牌無經過路線</p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto pr-2 pb-4 space-y-3">
              <p className="text-xs text-muted-foreground px-1">
                經過此站牌的路線
              </p>
              <div className="flex flex-wrap gap-2">
                {(selectedStop.routes || []).map((routeName, index) => (
                  <button
                    key={routeName}
                    type="button"
                    onClick={() =>
                      handleStopRouteSelect(routeName, selectedStop.city)
                    }
                    className="px-3 py-1.5 rounded-lg bg-muted/50 border border-border/30 text-sm font-semibold hover:bg-muted transition-colors"
                  >
                    {name(
                      selectedStop.displayLanguage === lang
                        ? selectedStop.routeDisplayNames?.[index]
                        : undefined,
                      routeName,
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0 space-y-4">
          <div className="flex rounded-lg bg-muted/60 border border-border/30 p-0.5 text-xs shrink-0">
            <button
              type="button"
              onClick={() => {
                if (mode !== "route") {
                  setMode("route");
                  setKeyword("");
                }
              }}
              className={`flex-1 py-1.5 rounded-md transition-colors ${
                mode === "route"
                  ? "bg-background shadow-sm font-medium"
                  : "text-muted-foreground"
              }`}
            >
              找路線
            </button>
            <button
              type="button"
              onClick={() => {
                if (mode !== "stop") {
                  setMode("stop");
                  setKeyword("");
                }
              }}
              className={`flex-1 py-1.5 rounded-md transition-colors ${
                mode === "stop"
                  ? "bg-background shadow-sm font-medium"
                  : "text-muted-foreground"
              }`}
            >
              找站牌
            </button>
          </div>

          <div className="relative shrink-0">
            <div className="relative flex items-center">
              <Search className="absolute left-3 h-4 w-4 text-muted-foreground" />
              <input
                ref={inputRef}
                type="text"
                value={keyword}
                onChange={(e) => {
                  setKeyword(e.target.value);
                  setOpen(true);
                }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 100)}
                placeholder={
                  mode === "route"
                    ? t("routeName") || "請輸入公車路線"
                    : t("stopName") || "請輸入站牌名稱"
                }
                className="w-full h-10 pl-9 pr-10 rounded-xl bg-muted/60 border border-border/30 text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              />
              {searchLoading && (
                <Loader2 className="absolute right-3 h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            {open && keyword.trim() && (
              <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-card rounded-xl border shadow-lg overflow-hidden max-h-[40vh] overflow-y-auto">
                <Command className="w-full bg-transparent">
                  <CommandList onMouseDown={(e) => e.preventDefault()}>
                    {mode === "route" ? (
                      Object.keys(groupedResults).length > 0 ? (
                        Object.entries(groupedResults).map(([city, routes]) => (
                          <CommandGroup
                            key={city}
                            heading={city}
                            className="px-1"
                          >
                            {routes.map((r) => (
                              <CommandItem
                                key={`${r.city}-${r.routeName}-${r.departure}-${r.destination}`}
                                value={`${r.city}-${r.routeName}-${r.departure}-${r.destination}`}
                                onSelect={() => handleRouteSelect(r)}
                                className="flex flex-col items-start px-3 py-2 cursor-pointer"
                              >
                                <span className="font-semibold text-sm">
                                  {name(r.routeDisplayName, r.routeName)}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {name(r.departureDisplayName, r.departure)} -{" "}
                                  {name(
                                    r.destinationDisplayName,
                                    r.destination,
                                  )}
                                </span>
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        ))
                      ) : !searchLoading ? (
                        <div className="p-4 text-center text-sm text-muted-foreground">
                          找不到相關路線
                        </div>
                      ) : null
                    ) : Object.keys(groupedStops).length > 0 ? (
                      Object.entries(groupedStops).map(([city, stops]) => (
                        <CommandGroup
                          key={city}
                          heading={city}
                          className="px-1"
                        >
                          {stops.map((s) => {
                            const stopRoutes = Array.isArray(s.routes)
                              ? s.routes
                              : [];
                            return (
                              <CommandItem
                                key={s.stopUid}
                                value={`${s.stopUid}-${s.stopName}`}
                                onSelect={() => handleStopSelect(s)}
                                className="flex flex-col items-start px-3 py-2 cursor-pointer"
                              >
                                <span className="font-semibold text-sm">
                                  {name(s.stopDisplayName, s.stopName)}
                                </span>
                                <span className="text-xs text-muted-foreground truncate max-w-full">
                                  {stopRoutes.length > 0
                                    ? stopRouteNames(s)
                                        .slice(0, 8)
                                        .join(" · ") +
                                      (stopRoutes.length > 8 ? " …" : "")
                                    : "無經過路線"}
                                </span>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      ))
                    ) : !searchLoading ? (
                      <div className="p-4 text-center text-sm text-muted-foreground">
                        找不到相關站牌
                      </div>
                    ) : null}
                  </CommandList>
                </Command>
              </div>
            )}
          </div>

          {!keyword.trim() && (
            <div className="flex-1 min-h-0 overflow-y-auto pr-1 pb-4 space-y-3">
              <div className="flex items-center justify-between px-1">
                <span className="text-xs font-semibold text-muted-foreground">
                  附近站牌
                </span>
                {nearbyLoading && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                )}
              </div>

              {!userLocation ? (
                <div className="text-center py-8 border border-dashed border-border/40 rounded-xl bg-muted/20">
                  <MapPin className="h-5 w-5 mx-auto text-muted-foreground/40 mb-1" />
                  <p className="text-xs text-muted-foreground">
                    開啟定位服務，以顯示最近的站牌資訊
                  </p>
                </div>
              ) : nearbyLoading && nearbyStops.length === 0 ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-emerald-500" />
                </div>
              ) : nearbyError ? (
                <p className="text-xs text-red-500 px-1">{nearbyError}</p>
              ) : nearbyStops.length === 0 ? (
                <p className="text-xs text-muted-foreground px-1">
                  周邊 500 公尺內無公車站牌
                </p>
              ) : (
                <div className="space-y-2">
                  {(nearbyLanguage === lang ? nearbyStops : []).map((stop) => {
                    const stopRoutes = Array.isArray(stop.routes)
                      ? stop.routes
                      : [];
                    return (
                      <button
                        key={stop.stopUid}
                        type="button"
                        onClick={() => handleStopSelect(stop)}
                        className="w-full text-left p-3 rounded-xl bg-muted/40 border border-border/30 hover:bg-muted/70 transition-all flex justify-between items-center group"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate group-hover:text-emerald-600 transition-colors">
                            {name(stop.stopDisplayName, stop.stopName)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {stopRouteNames(stop).slice(0, 5).join(" · ")}
                            {stopRoutes.length > 5 &&
                              ` +${stopRoutes.length - 5}條路線`}
                          </p>
                        </div>
                        {stop.distance !== undefined && (
                          <span className="text-xs font-medium text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded-md shrink-0 ml-2">
                            {stop.distance}m
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
