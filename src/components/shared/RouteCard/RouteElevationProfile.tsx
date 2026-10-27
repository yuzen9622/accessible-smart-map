"use client";

import { Info } from "lucide-react";
import { Marker } from "maplibre-gl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useAppTranslation } from "@/i18n/client";
import { getAppLanguage } from "@/i18n/language";
import {
  buildElevationChart,
  ELEVATION_PLOT,
  nearestElevationSample,
} from "@/lib/route/elevationChart";
import useMapStore from "@/stores/useMapStore";
import type {
  AvailableElevationProfile,
  ElevationProfile,
} from "@/types/elevation";
import { formatDistance } from "@/types/route";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";

function useElevationValue() {
  const { t } = useAppTranslation();
  const formatter = new Intl.NumberFormat(getAppLanguage(), {
    maximumFractionDigits: 0,
  });
  return (value: number | null) =>
    value != null && Number.isFinite(value)
      ? t("elevationMeters", { value: formatter.format(value) })
      : t("elevationInsufficient");
}

export function RouteElevationSummary({
  profile,
}: {
  profile: ElevationProfile;
}) {
  const { t } = useAppTranslation();
  const meters = useElevationValue();
  if (profile.status === "unavailable" || !profile.summary) return null;
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground tabular-nums">
      <span>
        {t("elevationAscent")} {meters(profile.summary.ascentM)}
      </span>
      <span>
        {t("elevationDescent")} {meters(profile.summary.descentM)}
      </span>
    </p>
  );
}

export function RouteElevationProfile({
  profile,
}: {
  profile: ElevationProfile;
}) {
  const { t } = useAppTranslation();
  const chart = useMemo(
    () =>
      profile.status === "complete" || profile.status === "partial"
        ? buildElevationChart(profile)
        : null,
    [profile],
  );
  if (!chart || profile.status === "unavailable") {
    return (
      <p className="py-2 text-sm text-muted-foreground">
        {t("elevationUnavailable")}
      </p>
    );
  }
  return <ElevationChart profile={profile} chart={chart} />;
}

function ElevationChart({
  profile,
  chart,
}: {
  profile: AvailableElevationProfile;
  chart: NonNullable<ReturnType<typeof buildElevationChart>>;
}) {
  const { t } = useAppTranslation();
  const meters = useElevationValue();
  const map = useMapStore((state) => state.map);
  const marker = useRef<Marker | null>(null);
  const slider = useRef<HTMLDivElement>(null);
  const gradientId = useId();
  const [selection, setSelection] = useState<{
    profile: AvailableElevationProfile;
    index: number;
  } | null>(null);
  const index = selection?.profile === profile ? selection.index : null;
  const sample = index === null ? null : profile.samples[index];
  const select = (next: number | null) =>
    setSelection((previous) =>
      next === null
        ? null
        : previous?.profile === profile && previous.index === next
          ? previous
          : { profile, index: next },
    );

  useEffect(() => {
    if (!slider.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) setSelection(null);
    });
    observer.observe(slider.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!map) return;
    const element = document.createElement("div");
    element.className =
      "h-4 w-4 rounded-full border-[3px] border-background bg-primary ring-2 ring-primary pointer-events-none";
    element.dataset.elevationMarker = "true";
    element.setAttribute("aria-hidden", "true");
    const instance = new Marker({ element });
    marker.current = instance;
    return () => {
      instance.remove();
      marker.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (!marker.current || !map) return;
    if (sample?.elevationM != null) {
      marker.current.setLngLat(sample.coordinates).addTo(map);
    } else {
      marker.current.remove();
    }
  }, [map, sample]);

  const sampleText = sample
    ? t("elevationPoint", {
        distance: formatDistance(sample.distanceM),
        elevation: meters(sample.elevationM),
      })
    : t("elevationPoint", {
        distance: formatDistance(0),
        elevation: meters(profile.samples[0].elevationM),
      });
  const { width, height, inset } = ELEVATION_PLOT;
  const pickSample = (element: HTMLElement, clientX: number) => {
    const bounds = element.getBoundingClientRect();
    const x = ((clientX - bounds.left) / bounds.width) * width;
    const distance =
      Math.max(0, Math.min(1, (x - inset) / (width - inset * 2))) *
      profile.distanceM;
    select(nearestElevationSample(profile.samples, distance));
  };

  return (
    <section
      aria-label={t("elevationTitle")}
      className="min-w-0 border-t border-border/70 pt-3 pb-1"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("elevationTitle")}</h2>
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={t("elevationDetails")}
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Info className="size-4" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="max-w-[calc(100vw-2rem)] space-y-3 text-sm motion-reduce:animate-none"
            aria-label={t("elevationDetails")}
          >
            <dl className="grid grid-cols-2 gap-3 tabular-nums">
              <div>
                <dt className="text-muted-foreground">{t("elevationMin")}</dt>
                <dd className="mt-1 font-medium">
                  {meters(profile.summary.minElevationM)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("elevationMax")}</dt>
                <dd className="mt-1 font-medium">
                  {meters(profile.summary.maxElevationM)}
                </dd>
              </div>
            </dl>
            <p className="leading-relaxed">{t("elevationSource")}</p>
          </PopoverContent>
        </Popover>
      </div>
      <RouteElevationSummary profile={profile} />
      <div className="relative mt-4 pr-12">
        <div
          ref={slider}
          role="slider"
          tabIndex={0}
          aria-label={t("elevationTitle")}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={profile.distanceM}
          aria-valuenow={sample?.distanceM ?? 0}
          aria-valuetext={sampleText}
          className="relative cursor-crosshair rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          onPointerMove={(event) => {
            if (event.pointerType === "mouse")
              pickSample(event.currentTarget, event.clientX);
          }}
          onPointerLeave={(event) => {
            if (
              event.pointerType === "mouse" &&
              document.activeElement !== event.currentTarget
            )
              select(null);
          }}
          onClick={(event) => pickSample(event.currentTarget, event.clientX)}
          onFocus={() => {
            if (index === null) select(0);
          }}
          onBlur={() => select(null)}
          onKeyDown={(event) => {
            const current = index ?? 0;
            const last = profile.samples.length - 1;
            const next = {
              ArrowRight: Math.min(last, current + 1),
              ArrowUp: Math.min(last, current + 1),
              ArrowLeft: Math.max(0, current - 1),
              ArrowDown: Math.max(0, current - 1),
              Home: 0,
              End: last,
              Escape: null,
            }[event.key];
            if (next !== undefined) {
              event.preventDefault();
              event.stopPropagation();
              select(next);
            }
          }}
        >
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className="block h-32 w-full overflow-visible"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--primary)"
                  stopOpacity="0.16"
                />
                <stop
                  offset="100%"
                  stopColor="var(--primary)"
                  stopOpacity="0.02"
                />
              </linearGradient>
            </defs>
            {chart.ticks.map((tick) => (
              <line
                key={tick}
                x1={inset}
                x2={width - inset}
                y1={chart.y(tick)}
                y2={chart.y(tick)}
                stroke="var(--border)"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {chart.segments.map(({ points, line }) => (
              <g key={points[0].index}>
                {points.length > 1 && (
                  <path
                    d={`${line} L${points.at(-1)?.x},${height - inset} L${points[0].x},${height - inset} Z`}
                    fill={`url(#${gradientId})`}
                  />
                )}
                <path
                  data-elevation-segment="line"
                  d={line}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                {points
                  .filter(
                    (point) =>
                      points.length === 1 ||
                      point.index === 0 ||
                      point.index === profile.samples.length - 1,
                  )
                  .map((point) => (
                    <circle
                      key={point.index}
                      cx={point.x}
                      cy={point.y}
                      r="3"
                      fill="var(--background)"
                      stroke="var(--primary)"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
              </g>
            ))}
            {sample && (
              <line
                x1={chart.x(sample.distanceM)}
                x2={chart.x(sample.distanceM)}
                y1={inset}
                y2={height - inset}
                stroke="var(--muted-foreground)"
                strokeDasharray="3 4"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {sample?.elevationM != null && (
              <circle
                cx={chart.x(sample.distanceM)}
                cy={chart.y(sample.elevationM)}
                r="4"
                fill="var(--primary)"
                stroke="var(--background)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute right-0 top-0 flex h-32 flex-col justify-between py-0.5 text-right text-xs tabular-nums text-muted-foreground"
        >
          {chart.ticks.map((tick, i) => (
            <span key={tick}>
              {i === 0 ? meters(tick) : tick.toLocaleString(getAppLanguage())}
            </span>
          ))}
        </div>
        <div
          aria-hidden
          className="mt-2 flex justify-between text-xs tabular-nums text-muted-foreground"
        >
          <span>{formatDistance(0)}</span>
          <span>{formatDistance(profile.distanceM)}</span>
        </div>
      </div>
      {sample && (
        <p className="mt-2 text-sm tabular-nums" aria-live="off">
          {sampleText}
        </p>
      )}
      {profile.status === "partial" && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("elevationPartial")}
        </p>
      )}
    </section>
  );
}
