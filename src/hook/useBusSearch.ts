import { useEffect, useState } from "react";
import { useAppTranslation } from "@/i18n/client";
import { getAppLanguage } from "@/i18n/language";
import { searchBusRoutes, searchBusStops } from "@/lib/api/transit";
import type { LatLng } from "@/types";
import type { BusSearchResult, BusStopSearchResult } from "@/types/transit";

export type BusSearchMode = "route" | "stop";

export default function useBusSearch(
  keyword: string,
  mode: BusSearchMode,
  location?: LatLng | null,
) {
  useAppTranslation();
  const lang = getAppLanguage();
  const [results, setResults] = useState<
    (BusSearchResult | BusStopSearchResult)[]
  >([]);
  const requestKey = JSON.stringify([keyword, mode, location, lang]);
  const [resultsKey, setResultsKey] = useState(requestKey);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResultsKey(requestKey);
    setResults([]);
    if (!keyword.trim()) {
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const currentMode = mode;
    let active = true;

    const handler = setTimeout(async () => {
      try {
        if (currentMode === "route") {
          const res = await searchBusRoutes(keyword.trim(), location, lang);
          if (!active) return;
          if (res.ok && Array.isArray(res.data?.routes)) {
            setResults(res.data.routes);
          } else {
            setResults([]);
            setError((res as { message?: string }).message || "No data");
          }
        } else {
          const res = await searchBusStops(keyword.trim(), location, lang);
          if (!active) return;
          if (res.ok && Array.isArray(res.data?.stops)) {
            setResults(res.data.stops);
          } else {
            setResults([]);
            setError((res as { message?: string }).message || "No data");
          }
        }
      } catch (err) {
        if (!active) return;
        setResults([]);
        setError(err instanceof Error ? err.message : "Error fetching data");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }, 400);

    return () => {
      active = false;
      clearTimeout(handler);
    };
  }, [keyword, mode, location, lang, requestKey]);

  return {
    results: resultsKey === requestKey ? results : [],
    loading: resultsKey === requestKey ? loading : Boolean(keyword.trim()),
    error: resultsKey === requestKey ? error : null,
  };
}
