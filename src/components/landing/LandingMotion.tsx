"use client";

import { type ReactNode, useEffect, useRef } from "react";

export default function LandingMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const animations = new Map<Element, Animation>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          animations.get(entry.target)?.play();
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" },
    );

    element.querySelectorAll("[data-reveal]").forEach((target) => {
      if (target.getBoundingClientRect().top < innerHeight - 40) return;
      const animation = target.animate(
        [
          { opacity: 0, transform: "translateY(32px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 900, easing: "cubic-bezier(.16,1,.3,1)", fill: "both" },
      );
      animation.pause();
      animation.onfinish = () => {
        animation.cancel();
        animations.delete(target);
      };
      animations.set(target, animation);
      observer.observe(target);
    });

    const revealFocused = (event: FocusEvent) => {
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest("[data-reveal]");
      if (target) animations.get(target)?.finish();
    };
    element.addEventListener("focusin", revealFocused);
    let frame = 0;
    const update = () => {
      frame = 0;
      const distance = document.documentElement.scrollHeight - innerHeight;
      element.style.setProperty(
        "--reading-progress",
        String(distance > 0 ? scrollY / distance : 0),
      );
      element.style.setProperty(
        "--hero-drift",
        `${Math.min(scrollY, 800) * 0.065}px`,
      );
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      animations.forEach((animation) => {
        animation.cancel();
      });
      cancelAnimationFrame(frame);
      removeEventListener("scroll", onScroll);
      element.removeEventListener("focusin", revealFocused);
      element.style.removeProperty("--hero-drift");
    };
  }, []);
  return (
    <div className="landing" ref={root}>
      {children}
    </div>
  );
}
