"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Iphone } from "@/components/ui/iphone";

const ease = [0.32, 0.72, 0, 1] as const;

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
      <fieldset className="segmented" aria-label="切換公車功能展示">
        {views.map((item, index) => (
          <button
            key={item.image}
            type="button"
            aria-pressed={selected === index}
            onClick={() => setSelected(index)}
          >
            {selected === index && (
              <motion.span
                className="segmented-thumb"
                layoutId="bus-segment"
                transition={{ duration: 0.55, ease }}
              />
            )}
            <span>{item.label}</span>
          </button>
        ))}
      </fieldset>
      <div className="journey-phone">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            key={view.image}
            initial={{ opacity: 0, y: 24, rotate: -2 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            exit={{ opacity: 0, y: -16, rotate: 2 }}
            transition={{ duration: 0.7, ease }}
          >
            <Iphone src={`/landing/${view.image}.webp`} alt={view.alt} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
