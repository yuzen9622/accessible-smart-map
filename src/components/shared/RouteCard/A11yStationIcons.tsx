import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { useAppTranslation } from "@/i18n/client";
import { getAppLanguage } from "@/i18n/language";
import { sourceName } from "@/lib/route/sourceNames";
import { cn } from "@/lib/utils";
import type { SlimOsmA11y } from "@/types/route";
import {
  A11Y_CATEGORY_ICON,
  dedupeA11yCategories,
  getA11yCategoryLabelKey,
  getWheelchairStatusKey,
} from "./utils";

export function A11yStationIcons({
  items,
  ariaLabel,
  displayLanguage,
}: {
  items?: SlimOsmA11y[];
  ariaLabel: string;
  displayLanguage?: "en" | "zh-TW";
}) {
  const { t } = useAppTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const listId = useId();
  const categories = dedupeA11yCategories(items);

  if (categories.length === 0) return null;

  return (
    <div className="ml-2.5">
      <div className="flex items-center gap-1">
        {categories.map((category) => {
          const Icon = A11Y_CATEGORY_ICON[category];
          return (
            <Icon
              key={category}
              className="h-3 w-3 text-blue-600 dark:text-blue-400"
              aria-label={t(getA11yCategoryLabelKey(category)) ?? category}
            />
          );
        })}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-label={`${ariaLabel} ${t("viewA11yDetails") ?? "查看無障礙設施詳情"}`}
          className="text-muted-foreground hover:text-foreground rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform duration-200 ease-out motion-reduce:transition-none",
              isOpen && "rotate-180",
            )}
          />
        </button>
      </div>
      <div
        id={listId}
        aria-hidden={!isOpen}
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <ul className="pl-2 my-1 space-y-1 text-xs text-muted-foreground">
            {(items ?? []).map((item, idx) => {
              const wheelchairKey = getWheelchairStatusKey(item.wheelchair);
              return (
                <li key={item.osmId || `${item.category}-${idx}`}>
                  {sourceName(
                    item.name,
                    item.nameEn,
                    item.displayName,
                    getAppLanguage(),
                    displayLanguage,
                  ) || t(getA11yCategoryLabelKey(item.category))}
                  {wheelchairKey && ` · ${t(wheelchairKey)}`}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
