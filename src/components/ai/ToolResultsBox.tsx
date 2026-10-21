"use client";

import {
  AccessibilityIcon,
  SearchIcon,
  TriangleAlertIcon,
} from "@animateicons/react/lucide";
import {
  Bus,
  ChevronDown,
  ChevronUp,
  Navigation,
  SquareParking,
  Thermometer,
  Wind,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import useOpenAiResult from "@/hook/useOpenAiResult";
import { useAppTranslation } from "@/i18n/client";
import {
  getAggregatedToolResults,
  type ToolCardIcon,
  type ToolResultItem,
} from "@/lib/toolResultCards";
import { cn } from "@/lib/utils";
import PlaceCard from "../shared/PlaceCard";
import { Badge } from "../ui/badge";

const CARD_ICONS: Record<ToolCardIcon, React.ReactNode> = {
  search: <SearchIcon size={14} />,
  a11y: <AccessibilityIcon size={14} />,
  parking: <SquareParking className="h-3.5 w-3.5" />,
  bus: <Bus className="h-3.5 w-3.5" />,
  air: <Wind className="h-3.5 w-3.5" />,
  env: <Thermometer className="h-3.5 w-3.5" />,
  hazard: <TriangleAlertIcon size={14} />,
  nav: <Navigation className="h-3.5 w-3.5" />,
};

function ToolResultCard({
  item,
  onClick,
}: {
  item: ToolResultItem;
  onClick?: () => void;
}) {
  return (
    <PlaceCard
      title={item.title}
      subtitle={item.subtitle}
      badge={item.badge}
      onClick={onClick}
    />
  );
}

export default function ToolResultsBox({
  activities,
}: {
  activities: Array<{
    name: string;
    result?: unknown;
    status?: string;
    displayLanguage?: "en" | "zh-TW";
  }>;
}) {
  const { t, i18n } = useAppTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const { openAiResult, flyTo } = useOpenAiResult();
  const [activeTab, setActiveTab] = useState(0);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Effective language changes must invalidate cards even when t retains its identity.
  const groups = useMemo(
    () => getAggregatedToolResults(activities, t),
    [activities, t, language],
  );

  if (!groups.length) return null;

  const totalItems = groups.reduce((acc, g) => acc + g.items.length, 0);
  const safeActiveTab = Math.min(activeTab, groups.length - 1);
  const currentGroup = groups[safeActiveTab];

  const handleClick = (item: ToolResultItem) => {
    if (!item.position) return;
    if (item.target) {
      openAiResult({
        id: item.id,
        position: item.position,
        title: item.title,
        desc: item.subtitle,
        target: item.target,
      });
    } else {
      flyTo(item.position);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col gap-1.5 mt-2 w-full max-w-[88vw] sm:max-w-[440px] rounded-2xl border border-border/50 bg-card/70 dark:bg-card/50 backdrop-blur-md p-2.5 shadow-2xs transition-all"
    >
      <button
        type="button"
        aria-expanded={!isCollapsed}
        className="flex w-full items-center justify-between gap-2 px-1 cursor-pointer select-none text-left rounded-md hover:bg-muted/40 transition-colors"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            {CARD_ICONS[currentGroup.icon]}
          </span>
          <span className="text-xs font-semibold text-foreground truncate">
            {groups.length === 1
              ? currentGroup.heading
              : t("toolResults.relatedResults")}
          </span>
          <Badge
            variant="secondary"
            className="text-[10px] px-1.5 py-0 h-4 font-normal text-muted-foreground"
          >
            {t("toolResults.itemCount", { count: totalItems })}
          </Badge>
        </div>

        <span
          className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors px-1.5 py-0.5 rounded-md"
          aria-hidden="true"
        >
          <span>
            {isCollapsed ? t("toolResults.expand") : t("toolResults.collapse")}
          </span>
          {isCollapsed ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronUp className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-2 pt-0.5 overflow-hidden"
          >
            {groups.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 px-0.5 scrollbar-none snap-x">
                {groups.map((g, idx) => (
                  <button
                    key={`${g.heading}-${g.icon}`}
                    type="button"
                    onClick={() => setActiveTab(idx)}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all shrink-0 snap-start",
                      safeActiveTab === idx
                        ? "bg-primary text-primary-foreground shadow-2xs font-semibold"
                        : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <span className="shrink-0">{CARD_ICONS[g.icon]}</span>
                    <span>{g.heading}</span>
                    <span className="text-[10px] opacity-80">
                      ({g.items.length})
                    </span>
                  </button>
                ))}
              </div>
            )}

            {currentGroup.note && (
              <div className="text-[11px] text-muted-foreground px-1">
                {currentGroup.note}
              </div>
            )}

            <div className="flex gap-2.5 overflow-x-auto pb-1.5 pt-0.5 px-0.5 snap-x w-full [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/20 hover:[&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-track]:bg-transparent">
              {currentGroup.items.map((item) => (
                <ToolResultCard
                  key={item.id}
                  item={item}
                  onClick={item.position ? () => handleClick(item) : undefined}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
