"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import useBusPanelTracking from "@/hook/useBusPanelTracking";
import { useAppTranslation } from "@/i18n/client";
import type { RouteDetailDirection } from "@/lib/api/transit";
import { createBusArrivalReminder } from "@/lib/transit/busArrivalReminder";
import {
  accessibleVehicle,
  rideCount,
  vehicleStopIndex,
} from "@/lib/transit/busPanelTracking";

export default function BusTrackingPanel({
  routeName,
  city,
  detail,
  initialBoarding,
  originName,
  unresolvedBranch,
}: {
  routeName: string;
  city: string;
  detail: RouteDetailDirection;
  initialBoarding: number | null;
  originName?: string;
  unresolvedBranch: boolean;
}) {
  const { t } = useAppTranslation();
  const [boarding, setBoarding] = useState<number | null>(initialBoarding);
  const [alighting, setAlighting] = useState<number | null>(null);
  const [reminding, setReminding] = useState(false);
  const target = useMemo(
    () =>
      boarding === null || detail.direction === 255 || unresolvedBranch
        ? null
        : { routeName, city, detail, boarding },
    [routeName, city, detail, boarding, unresolvedBranch],
  );
  const snapshot = useBusPanelTracking(target);
  const reminder = useMemo(
    () =>
      createBusArrivalReminder({
        requestPermission: async () => {
          if (
            typeof Notification !== "undefined" &&
            Notification.permission === "default"
          )
            await Notification.requestPermission();
        },
        fire: () => {
          const message = t("busTrackingReminderFired", {
            defaultValue: "公車將在 3 分鐘內抵達上車站",
          });
          toast.info(message);
          if (
            typeof Notification !== "undefined" &&
            Notification.permission === "granted"
          ) {
            try {
              new Notification(message);
            } catch {
              /* Page toast remains available. */
            }
          }
          setReminding(false);
        },
      }),
    [t],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: Target changes invalidate reminder intent even before another snapshot arrives.
  useEffect(() => {
    reminder.cancel();
    setReminding(false);
    return reminder.cancel;
  }, [reminder, target]);
  useEffect(() => {
    reminder.observe(snapshot, document.visibilityState === "visible");
  }, [snapshot, reminder]);
  const arrival = snapshot?.arrival;
  const vehicle = arrival?.plateNumb
    ? snapshot?.buses.find((b) => b.plateNumb === arrival.plateNumb)
    : undefined;
  const position = vehicle ? vehicleStopIndex(vehicle, detail.stops) : null;
  const accessible = vehicle ? accessibleVehicle(vehicle) : null;
  const count =
    boarding !== null && alighting !== null
      ? rideCount(boarding, alighting, detail.stops)
      : null;
  return (
    <section
      className="space-y-2 border rounded-xl p-3"
      aria-label={t("busTracking", { defaultValue: "公車追蹤" })}
    >
      {originName && (
        <p className="text-sm">
          {t("busTrackingOrigin", {
            defaultValue: "原選站牌：{{name}}",
            name: originName,
          })}
        </p>
      )}
      <label className="block text-sm">
        {t("busTrackingBoarding", { defaultValue: "你的上車站" })}
        <select
          className="block w-full min-h-11 bg-background border rounded-md"
          value={boarding ?? ""}
          disabled={detail.direction === 255}
          onChange={(e) => {
            setBoarding(e.target.value === "" ? null : Number(e.target.value));
            setAlighting(null);
          }}
        >
          <option value="">
            {t("busTrackingChoose", { defaultValue: "請明確選擇站牌" })}
          </option>
          {detail.stops.map((s, i) => (
            <option
              key={JSON.stringify([s.stopUid, s.seq, s.name, s.lat, s.lng])}
              value={i}
            >
              {i + 1}. {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        {t("busTrackingAlighting", { defaultValue: "下車站（僅下游站牌）" })}
        <select
          className="block w-full min-h-11 bg-background border rounded-md"
          value={alighting ?? ""}
          disabled={boarding === null}
          onChange={(e) =>
            setAlighting(e.target.value === "" ? null : Number(e.target.value))
          }
        >
          <option value="">
            {t("busTrackingChoose", { defaultValue: "請明確選擇站牌" })}
          </option>
          {detail.stops.map((s, i) =>
            boarding !== null && i > boarding ? (
              <option
                key={JSON.stringify([s.stopUid, s.seq, s.name, s.lat, s.lng])}
                value={i}
              >
                {i + 1}. {s.name}
              </option>
            ) : null,
          )}
        </select>
      </label>
      {count !== null && (
        <p>
          {t("busTrackingRideCount", {
            defaultValue: "搭乘 {{count}} 站",
            count,
          })}
        </p>
      )}
      <div aria-live="polite" className="text-sm space-y-1">
        <p>
          {arrival
            ? t("busTrackingEta", {
                defaultValue: "約 {{minutes}} 分鐘 · 車牌 {{plate}}",
                minutes: arrival.estimateMinutes,
                plate:
                  arrival.plateNumb ||
                  t("busTrackingUnknown", { defaultValue: "未知" }),
              })
            : t("busTrackingUnavailable", {
                defaultValue: "暫無可確認的到站資訊",
              })}
        </p>
        {vehicle && position !== null && (
          <p>
            {t("busTrackingPosition", {
              defaultValue: "約在 {{stop}} 附近",
              stop: detail.stops[position].name,
            })}
            {boarding !== null && position <= boarding
              ? ` · ${t("busTrackingStopsAway", { defaultValue: "距上車站約 {{count}} 站", count: boarding - position })}`
              : ""}
          </p>
        )}
        {accessible !== null && (
          <p>
            {t(
              accessible ? "busTrackingAccessible" : "busTrackingNotAccessible",
              {
                defaultValue: accessible
                  ? "低地板或有升降設備"
                  : "非低地板且無升降設備",
              },
            )}
          </p>
        )}
      </div>
      <ol
        className="text-xs max-h-36 overflow-auto"
        aria-label={t("busTrackingAxis", {
          defaultValue: "站牌與車輛位置（概略）",
        })}
      >
        {detail.stops.map((s, i) => (
          <li
            key={JSON.stringify([s.stopUid, s.seq, s.name, s.lat, s.lng])}
            className="py-1"
          >
            {i + 1}. {s.name}
            {i === boarding
              ? ` · ${t("busTrackingBoarding", { defaultValue: "你的上車站" })}`
              : ""}
            {i === alighting
              ? ` · ${t("busTrackingAlighting", { defaultValue: "下車站（僅下游站牌）" })}`
              : ""}
            {snapshot?.buses
              .filter((b) => vehicleStopIndex(b, detail.stops) === i)
              .map((b) => ` · 🚌 ${b.plateNumb}`)
              .join("")}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="min-h-11 px-3 border rounded-md"
        disabled={!target}
        aria-pressed={reminding}
        onClick={() => {
          if (reminding) {
            reminder.cancel();
            setReminding(false);
          } else {
            reminder.enable();
            setReminding(true);
            reminder.observe(snapshot, document.visibilityState === "visible");
          }
        }}
      >
        {t(
          reminding ? "busTrackingCancelReminder" : "busTrackingEnableReminder",
          { defaultValue: reminding ? "取消提醒" : "到站前 3 分鐘提醒" },
        )}
      </button>
      <p className="text-xs text-muted-foreground">
        {t("busTrackingForegroundNotice", {
          defaultValue:
            "請保持此頁面與公車面板開啟；背景或關閉時無法保證提醒。返回頁面後須取得新的到站資訊。",
        })}
      </p>
    </section>
  );
}
