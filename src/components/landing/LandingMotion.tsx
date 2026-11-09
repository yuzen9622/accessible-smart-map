"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionConfig } from "motion/react";
import { type ReactNode, useRef, useState } from "react";
import Image from "./LandingImage";

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function HeroAppIcon() {
  return (
    <div className="hero-app-icon">
      <div className="hero-brand-image">
        <Image src="/logo.webp" width={256} height={256} alt="" priority />
      </div>
    </div>
  );
}

export default function LandingMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [intro, setIntro] = useState(true);

  useGSAP(
    () => {
      const element = root.current;
      if (!element) return;
      const heroIcon = element.querySelector<HTMLElement>(".hero-brand-image");
      if (
        !heroIcon ||
        window.location.hash ||
        window.scrollY > 0 ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        setIntro(false);
        return;
      }

      const copy = element.querySelectorAll(
        ".hero-app-identity > p, .hero-copy > :not(.hero-app-identity)",
      );
      const preview = element.querySelector(".hero-preview");
      const baseline = element.querySelector(".hero-baseline");
      const rect = heroIcon.getBoundingClientRect();
      const iconSize = Math.min(256, Math.max(180, window.innerWidth * 0.24));
      const overflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";

      gsap.set(copy, { y: 24, autoAlpha: 0 });
      gsap.set([preview, baseline], { y: 40, autoAlpha: 0 });
      gsap.set(heroIcon, {
        x: window.innerWidth / 2 - (rect.left + rect.width / 2),
        y: window.innerHeight / 2 - (rect.top + rect.height / 2),
        scale: iconSize / rect.width,
        transformOrigin: "center center",
        zIndex: 101,
        position: "relative",
      });

      const timeline = gsap.timeline({ paused: true });
      timeline
        .to(
          ".landing-intro-backdrop",
          {
            opacity: 0,
            duration: 0.65,
            ease: "power2.out",
          },
          0,
        )
        .to(
          heroIcon,
          {
            x: 0,
            y: 0,
            scale: 1,
            duration: 0.85,
            ease: "power3.inOut",
            clearProps: "transform,transformOrigin,zIndex,position",
          },
          0,
        )
        .addLabel("arrived")
        .call(
          () => {
            document.documentElement.style.overflow = overflow;
            setIntro(false);
          },
          [],
          "arrived",
        )
        .to(
          copy,
          {
            y: 0,
            autoAlpha: 1,
            stagger: 0.08,
            duration: 0.7,
            ease: "power2.out",
            clearProps: "opacity,visibility,transform",
          },
          "arrived",
        )
        .to(
          [preview, baseline],
          {
            y: 0,
            autoAlpha: 1,
            stagger: 0.12,
            duration: 1,
            ease: "power2.out",
            clearProps: "opacity,visibility,transform",
          },
          "arrived+=0.2",
        );

      const delay = gsap.delayedCall(0.85, () => timeline.play());
      const skip = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        delay.kill();
        timeline.play();
      };
      window.addEventListener("keydown", skip);
      return () => {
        document.documentElement.style.overflow = overflow;
        window.removeEventListener("keydown", skip);
      };
    },
    { scope: root, dependencies: [] },
  );

  useGSAP(
    () => {
      const element = root.current;
      if (
        !element ||
        intro ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        return;
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
    { scope: root, dependencies: [intro], revertOnUpdate: true },
  );
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="landing" ref={root} data-intro={intro}>
        {children}
        {intro && <div className="landing-intro-backdrop" aria-hidden="true" />}
      </div>
      <noscript>
        <style>{`.landing-intro-backdrop { display: none; }`}</style>
      </noscript>
    </MotionConfig>
  );
}
