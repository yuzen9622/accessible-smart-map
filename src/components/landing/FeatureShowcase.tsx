"use client";

import {
  Accessibility,
  ArrowUpRight,
  BusFront,
  Footprints,
  Mountain,
} from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import Image from "./LandingImage";

const features = [
  {
    id: "walking",
    label: "一般模式",
    icon: Footprints,
    title: "看清每一段步行路線",
    description:
      "從散步到日常通勤，先看步行距離、預估時間與轉彎指引，了解接下來怎麼走。",
    image: "route-desktop",
    alt: "中山站附近到寧夏夜市的步行距離、高程與展開的轉彎指引",
    notes: ["查看步行距離", "預估所需時間", "逐步路線指引"],
  },
  {
    id: "wheelchair",
    label: "輪椅模式",
    icon: Accessibility,
    title: "出發前，先看通行條件",
    description:
      "依輪椅通行需求規劃，對照候選路線的通行評分，也留意沿途資料不足的提醒。",
    image: "wheelchair-desktop",
    alt: "輪椅模式前往寧夏夜市的公車與步行候選路線，含通行評分和資料提醒",
    notes: ["比較候選路線", "通行評分", "資料完整度提醒"],
  },
  {
    id: "transit",
    label: "大眾運輸",
    icon: BusFront,
    title: "串起步行、公車與捷運",
    description:
      "串起步行、公車與捷運，查看轉乘與站點資訊，讓整段旅程有跡可循。",
    image: "transit-desktop",
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
    alt: "劍潭站到圓山大飯店的綠色人行道路段與沿途高程曲線",
    notes: ["已對應的人行道", "路線高程變化", "累計上升與下降"],
  },
];

export default function FeatureShowcase() {
  const [selected, setSelected] = useState(0);
  const feature = features[selected];
  return (
    <div className="feature-showcase" data-reveal>
      <div className="feature-tabs" role="tablist" aria-label="探索路線功能">
        {features.map((item, index) => (
          <motion.button
            layout="position"
            key={item.id}
            id={`tab-${item.id}`}
            type="button"
            role="tab"
            aria-selected={selected === index}
            aria-controls={`panel-${item.id}`}
            tabIndex={selected === index ? 0 : -1}
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
            {selected === index && (
              <motion.span
                className="tab-indicator"
                layoutId="feature-tab"
                transition={{ duration: 0.3 }}
              />
            )}
            <item.icon size={20} aria-hidden="true" />
            <span>
              <span className="tab-label">{item.label}</span>
              {selected === index && (
                <motion.span
                  className="tab-description"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {item.notes.join(" · ")}
                </motion.span>
              )}
            </span>
            <ArrowUpRight className="tab-arrow" size={18} aria-hidden="true" />
          </motion.button>
        ))}
      </div>
      <div
        id={`panel-${feature.id}`}
        role="tabpanel"
        aria-labelledby={`tab-${feature.id}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: ARIA tab panels need a keyboard focus target.
        tabIndex={0}
        className="feature-panel"
      >
        <motion.div
          key={`copy-${feature.id}`}
          className="feature-copy"
          initial={selected === 0 ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <h3>{feature.title}</h3>
          <p>{feature.description}</p>
          <ul>
            {feature.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </motion.div>
        <motion.figure
          key={`image-${feature.id}`}
          className="desktop-capture"
          initial={selected === 0 ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Image
            width={1440}
            height={1000}
            src={`/landing/${feature.image}.webp`}
            alt={feature.alt}
            sizes="(max-width: 767px) 92vw, 70vw"
          />
        </motion.figure>
      </div>
    </div>
  );
}
