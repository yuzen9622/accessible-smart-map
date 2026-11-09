"use client";

import { Accessibility, BusFront, Footprints, Mountain } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import Image from "./LandingImage";

const ease = [0.32, 0.72, 0, 1] as const;

const features = [
  {
    id: "walking",
    label: "一般模式",
    icon: Footprints,
    title: "看清每一段步行路線",
    description:
      "從散步到日常通勤，先看步行距離、預估時間與轉彎指引，了解接下來怎麼走。",
    image: "route-desktop",
    caption: "捷運中山站 → 寧夏夜市",
    alt: "中山站附近到寧夏夜市的步行距離、高程與展開的轉彎指引",
    notes: ["查看步行距離", "預估所需時間", "逐步路線指引"],
  },
  {
    id: "wheelchair",
    label: "輪椅模式",
    icon: Accessibility,
    title: "出發前先看通行條件",
    description:
      "依輪椅通行需求規劃，對照候選路線的通行評分，也留意沿途資料不足的提醒。",
    image: "wheelchair-desktop",
    caption: "輪椅模式・候選路線比較",
    alt: "輪椅模式前往寧夏夜市的公車與步行候選路線，含通行評分和資料提醒",
    notes: ["比較候選路線", "通行評分", "資料完整度提醒"],
  },
  {
    id: "transit",
    label: "大眾運輸",
    icon: BusFront,
    title: "串起步行、公車與捷運",
    description: "查看轉乘與上下車站，連同兩端的步行接駁，讓整段旅程有跡可循。",
    image: "transit-desktop",
    caption: "捷運劍潭站 → 台北 101",
    alt: "劍潭站到台北 101 的捷運搭乘、上下車站與兩端步行接駁資訊",
    notes: ["公車與捷運", "步行接駁", "轉乘資訊"],
  },
  {
    id: "terrain",
    label: "人行道與坡度",
    icon: Mountain,
    title: "查看人行道與路線起伏",
    description:
      "從綠色人行道路段到高程起伏，將距離以外的路線條件一起納入考量。",
    image: "terrain-desktop",
    caption: "捷運劍潭站 → 圓山大飯店",
    alt: "劍潭站到圓山大飯店的綠色人行道路段與沿途高程曲線",
    notes: ["已對應的人行道", "路線高程變化", "累計上升與下降"],
  },
];

export default function FeatureShowcase() {
  const [selected, setSelected] = useState(0);
  const feature = features[selected];
  return (
    <div className="feature-showcase">
      <div
        className="feature-tabs"
        role="tablist"
        aria-label="探索路線功能"
        aria-orientation="vertical"
        data-reveal
      >
        {features.map((item, index) => {
          const active = selected === index;
          return (
            <button
              key={item.id}
              id={`tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`panel-${item.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => setSelected(index)}
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowRight" || event.key === "ArrowDown"
                    ? (index + 1) % features.length
                    : event.key === "ArrowLeft" || event.key === "ArrowUp"
                      ? (index + features.length - 1) % features.length
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? features.length - 1
                          : null;
                if (next !== null) {
                  event.preventDefault();
                  setSelected(next);
                  document.getElementById(`tab-${features[next].id}`)?.focus();
                }
              }}
            >
              {active && (
                <motion.span
                  className="tab-indicator"
                  layoutId="feature-tab"
                  transition={{ duration: 0.6, ease }}
                />
              )}
              <span className="tab-icon">
                <item.icon size={18} strokeWidth={1.4} aria-hidden="true" />
              </span>
              <span className="tab-label">{item.label}</span>
            </button>
          );
        })}
      </div>
      <div
        id={`panel-${feature.id}`}
        role="tabpanel"
        aria-labelledby={`tab-${feature.id}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: ARIA tab panels need a keyboard focus target.
        tabIndex={0}
        className="feature-panel"
        data-reveal
      >
        <div className="bezel feature-bezel">
          <div className="bezel-core browser">
            <div className="browser-bar" aria-hidden="true">
              <span />
              <span />
              <span />
              <p>map.yuzen.dev/map</p>
            </div>
            <div className="browser-view">
              <AnimatePresence initial={false} mode="popLayout">
                <motion.figure
                  key={feature.id}
                  className="browser-shot"
                  initial={{ opacity: 0, scale: 1.04, y: 24 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.98, y: -12 }}
                  transition={{ duration: 0.8, ease }}
                >
                  <Image
                    width={1440}
                    height={1000}
                    src={`/landing/${feature.image}.webp`}
                    alt={feature.alt}
                    sizes="(max-width: 767px) 92vw, 64vw"
                  />
                </motion.figure>
              </AnimatePresence>
            </div>
          </div>
        </div>
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={feature.id}
            className="feature-copy"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.5, ease }}
          >
            <p className="feature-caption">實際畫面・{feature.caption}</p>
            <h3>{feature.title}</h3>
            <p>{feature.description}</p>
            <ul>
              {feature.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
