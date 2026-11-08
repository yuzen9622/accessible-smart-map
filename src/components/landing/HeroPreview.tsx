"use client";

import {
  Accessibility,
  ArrowRight,
  BusFront,
  Footprints,
  MapPin,
  Route,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import Image from "./LandingImage";

const modes = [
  {
    label: "一般模式",
    icon: Footprints,
    image: "route-desktop",
    caption: "看清距離與轉彎，找到今天的走法",
    alt: "中山站附近到寧夏夜市的步行路線與轉彎指引",
  },
  {
    label: "輪椅模式",
    icon: Accessibility,
    image: "wheelchair-desktop",
    caption: "比較通行評分，留意沿途資料提醒",
    alt: "輪椅模式的公車與步行候選路線、通行評分及資料不足提醒",
  },
  {
    label: "大眾運輸",
    icon: BusFront,
    image: "transit-desktop",
    caption: "把步行、公車與捷運一起考慮",
    alt: "劍潭站到台北 101 的淡水信義線與步行接駁結果",
  },
];

export default function HeroPreview() {
  const [selected, setSelected] = useState(0);
  const mode = modes[selected];
  return (
    <div className="hero-preview">
      <div className="preview-topbar">
        <span>
          <Route size={18} /> 路線規劃
        </span>
        <span className="preview-caption">實際操作畫面</span>
      </div>
      <fieldset className="preview-modes" aria-label="切換首頁展示畫面">
        {modes.map((item, index) => (
          <button
            type="button"
            key={item.label}
            aria-pressed={selected === index}
            onClick={() => setSelected(index)}
          >
            {selected === index && (
              <motion.span
                className="mode-highlight"
                layoutId="hero-mode"
                transition={{ duration: 0.3 }}
              />
            )}
            <item.icon size={18} />
            <span>{item.label}</span>
          </button>
        ))}
      </fieldset>
      <div className="hero-map-capture">
        <AnimatePresence initial={false} mode="sync">
          <motion.div
            className="hero-capture-layer"
            key={mode.image}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.4 }}
          >
            <Image
              src={`/landing/${mode.image}.webp`}
              width={1440}
              height={1000}
              alt={mode.alt}
              priority={selected === 0}
              sizes="(max-width: 767px) 94vw, 62vw"
            />
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="preview-bottom">
        <MapPin size={16} />
        <span aria-live="polite">{mode.caption}</span>
        <ArrowRight size={16} aria-hidden="true" />
      </div>
    </div>
  );
}
