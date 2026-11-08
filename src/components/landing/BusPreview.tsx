"use client";

import { motion } from "motion/react";
import { useState } from "react";
import Image from "./LandingImage";

const views = [
  {
    label: "到站清單",
    image: "bus-arrivals-native",
    alt: "iPhone App 臺北車站忠孝站牌的即時公車到站清單與無障礙車篩選",
  },
  {
    label: "路線與提醒",
    image: "bus-route-native",
    alt: "iPhone App 265 區公車的到站倒數、站序與到站提醒按鈕",
  },
];

export default function BusPreview() {
  const [selected, setSelected] = useState(0);
  const view = views[selected];
  return (
    <div className="bus-preview">
      <fieldset className="bus-preview-controls" aria-label="切換公車功能展示">
        {views.map((item, index) => (
          <button
            key={item.image}
            type="button"
            aria-pressed={selected === index}
            onClick={() => setSelected(index)}
          >
            {item.label}
          </button>
        ))}
      </fieldset>
      <motion.div
        className="navigation-phone"
        key={view.image}
        initial={false}
        animate={{ opacity: [0.5, 1], y: [8, 0] }}
        transition={{ duration: 0.35 }}
      >
        <Image
          src={`/landing/${view.image}.webp`}
          width={1206}
          height={2622}
          alt={view.alt}
          sizes="(max-width: 767px) 220px, 240px"
        />
      </motion.div>
    </div>
  );
}
