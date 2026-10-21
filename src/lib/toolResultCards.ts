import i18next, { type TFunction } from "i18next";
import type { AiResultMarker, LatLng } from "@/types";
import {
  a11yPlacesToMarkers,
  getLatLng,
  googlePlacesToMarkers,
} from "./aiResults";

// biome-ignore lint/suspicious/noExplicitAny: 後端工具回傳形狀不固定，這裡刻意用 any 做防禦式存取
type AnyRec = Record<string, any>; // pi-lens-ignore: no-unsafe-dictionary-any -- Existing dynamic tool DTO boundary.

export type ToolCardIcon =
  | "search"
  | "a11y"
  | "parking"
  | "bus"
  | "air"
  | "env"
  | "hazard"
  | "nav";

export type ToolResultItem = {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  position?: LatLng | null;
  // 有 target → 開既有詳情面板；否則有 position → 飛到該點
  target?: AiResultMarker["target"];
};

export type ToolResultGroup = {
  heading: string;
  icon: ToolCardIcon;
  items: ToolResultItem[];
  /** 顯示在標題下的摘要文字（建議、天氣描述等） */
  note?: string;
};

const MAX_ITEMS = 30;

// Backend enum values map to frontend-owned translation keys.
const A11Y_CATEGORY_KEYS: Record<string, string> = {
  wheelchair_accessible: "wheelchairAccessible",
  kerb_cut: "kerbCut",
  ramp: "ramp",
  elevator: "elevator",
  toilet: "toilet",
};
const HAZARD_TYPE_KEYS: Record<string, string> = {
  obstacle: "obstacle",
  construction: "construction",
  data_error: "dataError",
};
const HAZARD_STATUS_KEYS: Record<string, string> = {
  pending: "pending",
  verified: "verified",
  rejected: "rejected",
  expired: "expired",
};

function isOk(res: AnyRec | null | undefined): res is AnyRec {
  if (!res || typeof res !== "object") return false;
  if (res.ok === false) return false;
  if (res.status && res.status !== "OK") return false;
  return true;
}

function str(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function displayText(v: unknown): string | undefined {
  return typeof v === "string" ? v.trim() || undefined : undefined;
}

function asArray(v: unknown): AnyRec[] {
  return Array.isArray(v) ? (v as AnyRec[]) : [];
}

/** Prefer English bilingual names in English; preserve backend strings verbatim. */
function localName(v: unknown, t: TFunction): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (v && typeof v === "object") {
    const o = v as AnyRec;
    return t("toolResults.locale") === "en"
      ? str(o.En) || str(o.Zh_tw) || str(o.zh_tw)
      : str(o.Zh_tw) || str(o.zh_tw) || str(o.En);
  }
  return undefined;
}

function isAffirmative(v: unknown): boolean {
  return ["1", "true", "是", "y", "yes"].includes(
    String(v ?? "")
      .trim()
      .toLowerCase(),
  );
}

/** TDX EstimateTime 為秒，轉成易讀文字 */
function fmtEtaSeconds(sec: unknown, t: TFunction): string | undefined {
  if (typeof sec !== "number" || !Number.isFinite(sec)) return undefined;
  if (sec <= 0) return t("toolResults.etaArriving");
  if (sec < 60) return t("toolResults.etaSoon");
  return t("toolResults.etaMinutes", { minutes: Math.round(sec / 60) });
}

function markersToItems(markers: AiResultMarker[]): ToolResultItem[] {
  return markers.map((m) => ({
    id: m.id,
    title: m.title,
    subtitle: m.desc,
    position: m.position,
    target: m.target,
  }));
}

/** 把含座標的陣列轉成可點飛行的卡片 */
function locationItems(
  items: AnyRec[],
  t: TFunction,
  opts: {
    prefix: string;
    id?: (it: AnyRec, index: number) => string | undefined;
    title: (it: AnyRec) => string | undefined;
    subtitle?: (it: AnyRec) => string | undefined;
    badge?: (it: AnyRec) => string | undefined;
    requirePosition?: boolean;
  },
): ToolResultItem[] {
  const out: ToolResultItem[] = [];
  items.forEach((it, i) => {
    const position = getLatLng(it);
    if (opts.requirePosition && !position) return;
    const rawId =
      opts.id?.(it, i) ??
      it.id ??
      it._id ??
      it.osmId ??
      it.plateNumb ??
      it.PlateNumb ??
      it.stopUid ??
      it.StopUID ??
      it.name ??
      i;
    out.push({
      id: `${opts.prefix}_${rawId}`,
      title: opts.title(it) || t("toolResults.item"),
      subtitle: opts.subtitle?.(it),
      badge: opts.badge?.(it),
      position,
    });
  });
  return out;
}

/**
 * 把任一工具的結果正規化成統一的卡片群組；無法渲染時回 null。
 */
export function getToolResultGroup(
  name: string,
  result: unknown,
  t: TFunction = i18next.t,
  resultLanguage?: "en" | "zh-TW",
): ToolResultGroup | null {
  const res = (result ?? {}) as AnyRec;
  if (!isOk(res)) return null;

  const useDisplay =
    resultLanguage === undefined || resultLanguage === t("toolResults.locale");
  const display = (value: unknown) =>
    useDisplay ? displayText(value) : undefined;

  const enumLabel = (
    keys: Record<string, string>,
    section: string,
    value: string,
  ) => (keys[value] ? t(`toolResults.${section}.${keys[value]}`) : undefined);
  const categoryLabel = (value: string) =>
    enumLabel(A11Y_CATEGORY_KEYS, "categories", value);

  switch (name) {
    case "findNearbyBusStops": {
      const items = locationItems(asArray(res.stops), t, {
        prefix: "nearby_stop",
        title: (s) => display(s.stopDisplayName) || localName(s.stopName, t),
        subtitle: (s) =>
          [
            str(s.distance) ? `${s.distance} m` : undefined,
            asArray(s.routes).join("、"),
          ]
            .filter(Boolean)
            .join(" · "),
      });
      return items.length
        ? {
            heading: t("toolResults.busStops", "附近公車站牌"),
            icon: "bus",
            items,
          }
        : null;
    }

    case "findCampusAccessibility":
    case "getCampusAccessibilityDetails": {
      let campuses = asArray(res.campuses);
      if (name === "getCampusAccessibilityDetails") {
        campuses = res.campus ? [res.campus] : [];
      }
      const items = locationItems(campuses, t, {
        prefix: "campus",
        id: (c) => str(c.campusId),
        title: (c) =>
          [
            display(c.displaySchoolName) || str(c.schoolName),
            display(c.displayBranchName) || str(c.branchName),
          ]
            .filter(Boolean)
            .join(" · "),
        subtitle: (c) => display(c.displayAddress) || str(c.address),
      });
      return items.length
        ? {
            heading: t("toolResults.campuses", "校園無障礙資訊"),
            icon: "a11y",
            items,
          }
        : null;
    }

    case "findGooglePlaces": {
      const items = markersToItems(googlePlacesToMarkers(result, t));
      return items.length
        ? { heading: t("toolResults.nearbyPlaces"), icon: "search", items }
        : null;
    }

    case "findA11yPlaces": {
      const items = markersToItems(a11yPlacesToMarkers(result, t, useDisplay));
      return items.length
        ? { heading: t("toolResults.a11yFacilities"), icon: "a11y", items }
        : null;
    }

    // SlimOsmA11y[]: { osmId, name?, category(enum), wheelchair?, location: GeoPoint }
    case "getA11yFacilityDetails": {
      const items = locationItems(asArray(res.facilities), t, {
        prefix: "a11yfac",
        title: (f) =>
          display(f.displayName) ||
          str(f.name) ||
          categoryLabel(f.category) ||
          str(f.category),
        subtitle: (f) =>
          [
            categoryLabel(f.category) || str(f.category),
            f.wheelchair === "yes"
              ? t("toolResults.wheelchairAccessible")
              : f.wheelchair === "limited"
                ? t("toolResults.partiallyAccessible")
                : undefined,
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
      });
      return items.length
        ? { heading: t("toolResults.a11yDetails"), icon: "a11y", items }
        : null;
    }

    // 停車格 / 停車場混合（ParkingSpaceNearby | ParkingLotNearby）：
    // 格位用 placeName/district/quantity，停車場用 name/address/disabledSpaces。
    case "findNearbyParking": {
      const items = locationItems(asArray(res.parkingSpots), t, {
        prefix: "parking",
        title: (p) =>
          display(p.displayName) ||
          str(p.placeName) ||
          str(p.name) ||
          t("toolResults.accessibleParking"),
        subtitle: (p) =>
          [
            display(p.displayAddress) ||
              str(p.address) ||
              str(p.district) ||
              str(p.city),
            str(p.spaceLabel),
          ]
            .filter(Boolean)
            .join(" · ") || str(p.chargeType),
        badge: (p) => {
          const n = p.disabledSpaces ?? p.quantity ?? p.availableSpaces;
          const q = str(n);
          return q != null
            ? t("toolResults.parkingSpaces", { count: Number(q) })
            : undefined;
        },
        requirePosition: true,
      });
      const total = str(res.total);
      return items.length
        ? {
            heading: t("toolResults.accessibleParking"),
            icon: "parking",
            items,
            note: total
              ? t("toolResults.nearbyCount", { count: Number(total) })
              : undefined,
          }
        : null;
    }

    // HazardReport[]: { hazardType, reportedLocation.coordinates, description, status, aiAnalysis.summary }
    case "getNearbyHazards": {
      const reports = [
        ...asArray(res.data?.reports ?? res.reports ?? res.data),
        ...asArray(res.data?.roadEvents ?? res.roadEvents),
      ];
      const items = locationItems(reports, t, {
        prefix: "hazard",
        title: (r) =>
          str(r.title) ||
          str(r.eventName) ||
          enumLabel(HAZARD_TYPE_KEYS, "hazardTypes", r.hazardType) ||
          str(r.hazardType) ||
          str(r.type) ||
          t("toolResults.hazardReport"),
        subtitle: (r) =>
          str(r.description) ||
          str(r.aiAnalysis?.summary) ||
          enumLabel(HAZARD_STATUS_KEYS, "hazardStatuses", r.status) ||
          str(r.status),
        requirePosition: true,
      });
      return items.length
        ? { heading: t("toolResults.nearbyHazards"), icon: "hazard", items }
        : null;
    }

    // LiveBus[]: { plateNumb, routeName, directionLabel, lat, lng, isLowFloor, hasLiftOrRamp, statusLabel, stopsAway }
    case "trackBuses": {
      const items = locationItems(asArray(res.buses), t, {
        prefix: "bus",
        id: (b, i) => str(b.plateNumb) || str(b.PlateNumb) || String(i),
        title: (b) => {
          const route =
            display(res.routeDisplayName) ||
            str(b.routeName) ||
            str(res.routeName);
          const plate = str(b.plateNumb);
          if (route && plate && route !== plate) {
            return `${route} · ${plate}`;
          }
          return route || plate || t("toolResults.bus");
        },
        subtitle: (b) =>
          [
            str(b.directionLabel),
            b.stopsAway != null
              ? t("toolResults.stopsAway", { count: Number(b.stopsAway) })
              : str(b.statusLabel),
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
        badge: (b) =>
          isAffirmative(b.isLowFloor) || isAffirmative(b.hasLiftOrRamp)
            ? t("toolResults.lowFloor")
            : undefined,
        requirePosition: true,
      });
      const count = str(res.count);
      const low = str(res.lowFloorCount);
      const note = [
        count != null
          ? t("toolResults.busCount", { count: Number(count) })
          : null,
        low != null
          ? t("toolResults.lowFloorCount", { count: Number(low) })
          : null,
      ]
        .filter(Boolean)
        .join("，");
      return items.length
        ? {
            heading: t("toolResults.liveBuses"),
            icon: "bus",
            items,
            note: note || undefined,
          }
        : null;
    }

    // directions[].stops（TDX 形狀：StopName.Zh_tw、StopPosition、EstimateTime 秒）
    case "getBusRoute":
    case "getBusRouteDetail": {
      const dirs = asArray(res.directions);
      const stops: AnyRec[] = [];
      for (const d of dirs) {
        const dirLabel =
          display(d.toDisplayName) ||
          str(d.to) ||
          localName(d.destination ?? d.DestinationStop, t) ||
          str(d.direction);
        for (const s of asArray(d.stops)) stops.push({ ...s, __dir: dirLabel });
      }
      const items = locationItems(stops, t, {
        prefix: "stop",
        id: (s, i) =>
          str(s.StopUID) ||
          str(s.stopUid) ||
          str(s.StopID) ||
          str(s.stopId) ||
          String(i),
        title: (s) =>
          display(s.displayName) ||
          localName(s.StopName, t) ||
          str(s.stopName) ||
          str(s.name) ||
          t("toolResults.stop"),
        subtitle: (s) => {
          const etaRaw = s.EstimateTime ?? s.estimateTime ?? s.eta;
          const eta =
            typeof etaRaw === "number" ? fmtEtaSeconds(etaRaw, t) : str(etaRaw);
          return [str(s.__dir), eta].filter(Boolean).join(" · ") || undefined;
        },
      });
      const routeName =
        display(res.routeDisplayName) ||
        localName(res.routeName, t) ||
        str(res.routeNo);
      return items.length
        ? {
            heading: routeName
              ? t("toolResults.routeStops", { route: routeName })
              : t("toolResults.busStops"),
            icon: "bus",
            items,
          }
        : null;
    }

    case "getBusTimetable": {
      const schedules = asArray(res.schedules).flatMap((s) =>
        Array.isArray(s.frequencies)
          ? asArray(s.frequencies).map((f, i) => ({
              ...f,
              time:
                str(f.originDepartureTime) ||
                [str(f.start), str(f.end)].filter(Boolean).join("–"),
              destination:
                display(f.originStopDisplayName) ||
                str(f.originStopName) ||
                display(s.subRouteDisplayName) ||
                str(s.subRouteName),
              __id: `${s.subRouteUid ?? "schedule"}_${s.direction ?? "unknown"}_${i}`,
            }))
          : [s],
      );
      const items: ToolResultItem[] = schedules
        .slice(0, MAX_ITEMS)
        .map((s, i) => {
          const rawTime =
            str(s.time) ||
            str(s.DepartureTime) ||
            str(s.departureTime) ||
            str(s.ArrivalTime);
          return {
            id: `sched_${s.__id ?? i}`,
            title: rawTime || t("toolResults.departure"),
            subtitle:
              [localName(s.destination ?? s.DestinationStop, t), str(s.note)]
                .filter(Boolean)
                .join(" · ") || undefined,
          };
        })
        .filter((it, i) =>
          Boolean(
            str(schedules[i].time) ||
              str(schedules[i].DepartureTime) ||
              str(schedules[i].departureTime) ||
              str(schedules[i].ArrivalTime) ||
              it.subtitle,
          ),
        );
      const routeName =
        display(res.routeDisplayName) || localName(res.routeName, t);
      return items.length
        ? {
            heading: routeName
              ? t("toolResults.routeTimetable", { route: routeName })
              : t("toolResults.busTimetable"),
            icon: "bus",
            items,
          }
        : null;
    }

    // getAirQuality 工具：{ pm25, quality, advice, coordinates, city, area }
    case "getAirQuality": {
      const pm25 = str(res.pm25);
      const quality = str(res.quality) || str(res.description);
      const position = getLatLng(res.coordinates ?? res);
      const place = [str(res.city), str(res.area)].filter(Boolean).join(" ");
      if (pm25 == null && quality == null) return null;
      return {
        heading: place
          ? t("toolResults.airQualityPlace", { place })
          : t("toolResults.airQuality"),
        icon: "air",
        note: str(res.advice),
        items: [
          {
            id: "air_0",
            title:
              pm25 != null
                ? `PM2.5 ${pm25} μg/m³`
                : (quality ?? t("toolResults.airQuality")),
            subtitle: pm25 != null ? quality : undefined,
            position,
          },
        ],
      };
    }

    // EnvironmentData: { weather{temperature,condition,...}, airQuality{description,quality}, cameras{items:[{name,url,distance}]} }
    case "getEnvironmentInfo": {
      const items: ToolResultItem[] = [];
      const w = res.weather as AnyRec | undefined;
      if (w && w.status !== "unavailable") {
        const temp = str(w.temperature ?? w.temp);
        const desc = str(w.condition ?? w.description ?? w.weather);
        const title =
          [temp != null ? `${temp}°C` : null, desc].filter(Boolean).join(" ") ||
          t("toolResults.weather");
        const rain = str(w.precipitationProbability);
        items.push({
          id: "env_weather",
          title,
          subtitle:
            rain != null
              ? t("toolResults.rainChance", { percent: rain })
              : undefined,
        });
      }
      const aq = res.airQuality as AnyRec | undefined;
      if (aq && aq.status !== "unavailable") {
        const pm25 = str(aq.pm25);
        items.push({
          id: "env_air",
          title:
            pm25 != null
              ? `PM2.5 ${pm25}`
              : t("toolResults.airQualityValue", {
                  quality: str(aq.quality) ?? "",
                }).trim(),
          subtitle: str(aq.description),
          position: getLatLng(aq.coordinates ?? aq),
        });
      }
      // cameras.items（EnvironmentData）或 nearbyCctv（工具別名）；多半無座標
      const cams = asArray(res.cameras?.items ?? res.nearbyCctv);
      cams.slice(0, MAX_ITEMS).forEach((c, i) => {
        items.push({
          id: `cctv_${i}`,
          title: str(c.name) || str(c.title) || t("toolResults.liveCamera"),
          subtitle:
            c.distance != null
              ? t("toolResults.distanceMeters", {
                  distance: Math.round(Number(c.distance)),
                })
              : str(c.address) || str(c.road),
          position: getLatLng(c),
        });
      });

      return items.length
        ? { heading: t("toolResults.environment"), icon: "env", items }
        : null;
    }

    // NavInstruction[]: { text, type, relativeDirection, distanceM, streetName }（無座標）
    case "getNavInstructions": {
      const instructions = asArray(res.instructions);
      const items: ToolResultItem[] = instructions
        .slice(0, MAX_ITEMS)
        .map((step, i) => {
          const dist =
            typeof step.distanceM === "number" && step.distanceM > 0
              ? step.distanceM >= 1000
                ? `${(step.distanceM / 1000).toFixed(1)} km`
                : `${Math.round(step.distanceM)} m`
              : undefined;
          return {
            id: `nav_${i}`,
            title:
              str(step.text) ||
              str(step.instruction) ||
              t("toolResults.step", { count: i + 1 }),
            subtitle:
              [str(step.relativeDirection), str(step.streetName), dist]
                .filter(Boolean)
                .join(" · ") || undefined,
          };
        });
      const total = str(res.totalSteps);
      return items.length
        ? {
            heading: t("toolResults.navigation"),
            icon: "nav",
            items,
            note: total
              ? t("toolResults.stepCount", { count: Number(total) })
              : undefined,
          }
        : null;
    }

    default:
      return null;
  }
}

const MAX_DISPLAY_ITEMS_PER_GROUP = 12;

function mergeIntoExistingGroup(
  existing: ToolResultGroup,
  incoming: ToolResultGroup,
): ToolResultGroup {
  const seenIds = new Set(existing.items.map((it) => it.id));

  const mergedItems = [...existing.items];
  for (const it of incoming.items) {
    if (!seenIds.has(it.id)) {
      seenIds.add(it.id);
      mergedItems.push(it);
    }
  }

  let mergedNote = existing.note;
  if (incoming.note && incoming.note !== existing.note) {
    mergedNote = existing.note
      ? `${existing.note} · ${incoming.note}`
      : incoming.note;
  }

  return {
    ...existing,
    items: mergedItems.slice(0, MAX_DISPLAY_ITEMS_PER_GROUP),
    note: mergedNote,
  };
}

/**
 * 將一則訊息內的多個 ToolActivity 聚合為去重且整理過的 ToolResultGroup 列表。
 * - 相同 heading/icon 的群組自動合併並依據 id 去重
 * - 單一群組限制最多顯示項目數，避免畫面過度膨脹
 */
export function getAggregatedToolResults(
  activities:
    | Array<{
        name: string;
        result?: unknown;
        status?: string;
        displayLanguage?: "en" | "zh-TW";
      }>
    | undefined,
  t: TFunction = i18next.t,
): ToolResultGroup[] {
  if (!activities?.length) return [];

  const groups: ToolResultGroup[] = [];

  for (const act of activities) {
    if (act.status === "running") continue;
    const group = getToolResultGroup(
      act.name,
      act.result,
      t,
      act.displayLanguage,
    );
    if (!group?.items.length) continue;

    const existingIndex = groups.findIndex(
      (g) => g.icon === group.icon && g.heading === group.heading,
    );

    if (existingIndex !== -1) {
      groups[existingIndex] = mergeIntoExistingGroup(
        groups[existingIndex],
        group,
      );
    } else {
      groups.push({
        ...group,
        items: group.items.slice(0, MAX_DISPLAY_ITEMS_PER_GROUP),
      });
    }
  }

  return groups;
}
