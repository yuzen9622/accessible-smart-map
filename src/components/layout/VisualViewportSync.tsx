"use client";

import { useEffect, useRef } from "react";

export function VisualViewportSync() {
  const animationFrame = useRef<number | null>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    // WebKit can leave the layout viewport full-height beneath its keyboard,
    // which gives Safari room to pan the page instead of keeping the app shell visible.
    const update = () => {
      document.documentElement.style.setProperty(
        "--vvh",
        `${viewport.height}px`,
      );
    };

    const scheduleUpdate = () => {
      if (animationFrame.current !== null) {
        return;
      }

      animationFrame.current = window.requestAnimationFrame(() => {
        animationFrame.current = null;
        update();
      });
    };

    update();
    viewport.addEventListener("resize", scheduleUpdate);
    viewport.addEventListener("scroll", scheduleUpdate);

    return () => {
      viewport.removeEventListener("resize", scheduleUpdate);
      viewport.removeEventListener("scroll", scheduleUpdate);

      if (animationFrame.current !== null) {
        window.cancelAnimationFrame(animationFrame.current);
      }
    };
  }, []);

  return null;
}
