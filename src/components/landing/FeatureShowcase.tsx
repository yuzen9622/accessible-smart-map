"use client";

import { Accessibility, BusFront, Footprints, Mountain } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { Safari } from "@/components/landing/magicui/safari";

const features = [
  {
    id: "walking",
    label: "一般模式",
    icon: Footprints,
    title: "你的日常，有更多走法。",
    description:
      "從散步到日常通勤，比較路線、距離與沿途資訊，選擇適合今天的走法。",
    image: "route-desktop",
    alt: "一般步行模式的實際路線規劃結果與地圖",
    notes: ["比較候選路線", "查看步行距離", "逐步導航指引"],
  },
  {
    id: "wheelchair",
    label: "輪椅模式",
    icon: Accessibility,
    title: "把通行需要，放在起點。",
    description:
      "依輪椅通行需求規劃，考慮階梯、坡度與電梯資訊，出發前先看路線條件。",
    image: "wheelchair-desktop",
    alt: "輪椅模式的實際路線設定畫面",
    notes: ["輪椅通行條件", "避開階梯", "查看沿途設施"],
  },
  {
    id: "transit",
    label: "大眾運輸",
    icon: BusFront,
    title: "走到站，再一起往前。",
    description:
      "串起步行、公車與捷運，查看轉乘與站點資訊，讓整段旅程有跡可循。",
    image: "transit-desktop",
    alt: "大眾運輸模式的實際規劃結果",
    notes: ["公車與捷運", "步行接駁", "轉乘資訊"],
  },
  {
    id: "terrain",
    label: "人行道與坡度",
    icon: Mountain,
    title: "多看一點，路就更清楚。",
    description:
      "從綠色人行道路段到高程起伏，將距離以外的路線條件一起納入考量。",
    image: "terrain-desktop",
    alt: "實際路線上的綠色人行道路段與高程圖",
    notes: ["已對應的人行道", "路線高程變化", "資料完整度提示"],
  },
];

export default function FeatureShowcase() {
  const [selected, setSelected] = useState(0);
  const feature = features[selected];
  return (
    <div className="feature-showcase" data-reveal>
      <div className="feature-tabs" role="tablist" aria-label="探索路線功能">
        {features.map((item, index) => (
          <button
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
                event.key === "ArrowRight"
                  ? (index + 1) % features.length
                  : event.key === "ArrowLeft"
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
                transition={{ type: "spring", stiffness: 380, damping: 34 }}
              />
            )}
            <item.icon size={20} aria-hidden="true" />
            <span className="tab-label">{item.label}</span>
          </button>
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
          <span className="feature-number" aria-hidden="true">
            0{selected + 1}
            <span> / 04</span>
          </span>
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
          <Safari
            url="map.yuzen.dev/map"
            imageSrc={`/landing/${feature.image}.webp`}
            alt={feature.alt}
            sizes="(max-width: 767px) 92vw, 70vw"
          />
          <figcaption>
            實際網頁版操作畫面。路線與資訊依查詢結果而異。
          </figcaption>
        </motion.figure>
      </div>
    </div>
  );
}
