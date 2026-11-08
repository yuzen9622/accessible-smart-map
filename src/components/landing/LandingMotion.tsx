"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionConfig } from "motion/react";
import { type ReactNode, useRef } from "react";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export default function LandingMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const element = root.current;
      if (!element) return;
      gsap.from(".hero-copy > *", {
        y: 24,
        opacity: 0,
        stagger: 0.1,
        duration: 0.7,
        ease: "power2.out",
        clearProps: "all",
      });
      gsap.from(".hero-preview", {
        y: 40,
        opacity: 0,
        duration: 1,
        delay: 0.15,
        ease: "power2.out",
        clearProps: "all",
      });
      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((target) => {
        if (target.getBoundingClientRect().top < window.innerHeight) return;
        gsap.from(target, {
          y: 32,
          opacity: 0,
          duration: 0.7,
          ease: "power2.out",
          clearProps: "all",
          scrollTrigger: { trigger: target, start: "top 94%", once: true },
        });
      });
      gsap.from(".terrain-statement span", {
        opacity: 0.25,
        stagger: 0.2,
        ease: "none",
        scrollTrigger: {
          trigger: ".terrain-statement",
          start: "top 85%",
          end: "top 45%",
          scrub: true,
        },
      });
      gsap.utils
        .toArray<SVGPathElement>("[data-route-line]")
        .forEach((path) => {
          gsap.fromTo(
            path,
            { strokeDasharray: 1, strokeDashoffset: 1 },
            {
              strokeDashoffset: 0,
              autoRound: false,
              duration: 1.4,
              ease: "power2.inOut",
              scrollTrigger: { trigger: path, start: "top 92%", once: true },
            },
          );
        });
      gsap.to(".closing-route-flow", {
        strokeDashoffset: "-=1",
        autoRound: false,
        duration: 7,
        repeat: -1,
        ease: "none",
        scrollTrigger: {
          trigger: ".closing-section",
          start: "top bottom",
          end: "bottom top",
          toggleActions: "play pause resume pause",
        },
      });
      gsap.to(".reading-progress", {
        scaleX: 1,
        ease: "none",
        scrollTrigger: { start: 0, end: "max", scrub: true },
      });
      const media = gsap.matchMedia();
      media.add("(min-width: 960px) and (min-height: 820px)", () => {
        const cards = gsap.utils.toArray<HTMLElement>(".journey-feature");
        cards.slice(0, -1).forEach((card, i) => {
          gsap.to(card, {
            scale: 0.96,
            transformOrigin: "top center",
            ease: "none",
            scrollTrigger: {
              trigger: cards[i + 1],
              start: "top 85%",
              end: "top 140px",
              scrub: true,
            },
          });
        });
      });
      const showFocused = (event: FocusEvent) => {
        if (!(event.target instanceof Element)) return;
        const reveal = event.target.closest<HTMLElement>("[data-reveal]");
        if (reveal) {
          gsap.killTweensOf(reveal);
          gsap.set(reveal, { clearProps: "opacity,transform" });
        }
      };
      let resizeFrame = 0;
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => ScrollTrigger.refresh());
      });
      observer.observe(element);
      element.addEventListener("focusin", showFocused);
      return () => {
        observer.disconnect();
        cancelAnimationFrame(resizeFrame);
        media.revert();
        element.removeEventListener("focusin", showFocused);
      };
    },
    { scope: root },
  );
  return (
    <MotionConfig
      reducedMotion="never"
      transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="landing" ref={root}>
        {children}
      </div>
    </MotionConfig>
  );
}
