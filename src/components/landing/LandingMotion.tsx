"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { MotionConfig } from "motion/react";
import { type ReactNode, useRef, useState } from "react";
import Image from "./LandingImage";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const SILK = "expo.out";
const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  // Opening: the app icon flies from screen centre into the hero, then the hero assembles.
  useGSAP(
    () => {
      const element = root.current;
      if (!element) return;
      const heroIcon = element.querySelector<HTMLElement>(".hero-brand-image");
      if (
        !heroIcon ||
        window.location.hash ||
        window.scrollY > 0 ||
        reducedMotion()
      ) {
        setIntro(false);
        return;
      }

      const chars = element.querySelectorAll("#hero-title .split-char");
      const copy = element.querySelectorAll(
        ".hero-label, .hero-description, .hero-actions > *, .hero-modes li",
      );
      const phones = element.querySelectorAll("[data-hero-phone]");
      const extras = element.querySelectorAll(
        ".hero-scroll-cue, .landing-header, .hero-halo, .hero-chip",
      );
      const rect = heroIcon.getBoundingClientRect();
      const iconSize = Math.min(220, Math.max(150, window.innerWidth * 0.2));
      const overflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = "hidden";

      gsap.set(chars, { yPercent: 115, rotate: 6 });
      gsap.set(copy, { y: 28, autoAlpha: 0, filter: "blur(8px)" });
      gsap.set(phones, { y: 160, autoAlpha: 0, scale: 0.9 });
      gsap.set(extras, { autoAlpha: 0 });
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
        .to(".landing-intro-backdrop", { opacity: 0, duration: 0.9 }, 0)
        .to(
          heroIcon,
          {
            x: 0,
            y: 0,
            scale: 1,
            duration: 1.1,
            ease: "expo.inOut",
            clearProps: "transform,transformOrigin,zIndex,position",
          },
          0,
        )
        .addLabel("arrived", 0.75)
        .call(
          () => {
            document.documentElement.style.overflow = overflow;
            setIntro(false);
          },
          [],
          "arrived+=0.6",
        )
        .to(
          chars,
          {
            yPercent: 0,
            rotate: 0,
            stagger: 0.045,
            duration: 1.2,
            ease: SILK,
            clearProps: "transform",
          },
          "arrived",
        )
        .to(
          copy,
          {
            y: 0,
            autoAlpha: 1,
            filter: "blur(0px)",
            stagger: 0.06,
            duration: 1,
            ease: SILK,
            clearProps: "opacity,visibility,transform,filter",
          },
          "arrived+=0.25",
        )
        .to(
          phones,
          {
            y: 0,
            autoAlpha: 1,
            scale: 1,
            stagger: { each: 0.1, from: "center" },
            duration: 1.4,
            ease: SILK,
            clearProps: "all",
          },
          "arrived+=0.15",
        )
        .to(
          extras,
          { autoAlpha: 1, duration: 0.9, clearProps: "opacity,visibility" },
          "arrived+=0.6",
        );

      const delay = gsap.delayedCall(0.7, () => timeline.play());
      const skip = (event: KeyboardEvent) => {
        if (event.key !== "Escape") return;
        delay.kill();
        timeline.progress(1);
      };
      window.addEventListener("keydown", skip);
      return () => {
        document.documentElement.style.overflow = overflow;
        window.removeEventListener("keydown", skip);
      };
    },
    { scope: root, dependencies: [] },
  );

  // Scroll choreography, once the intro has handed control back to the reader.
  useGSAP(
    () => {
      const element = root.current;
      if (!element || intro) return;
      const header = element.querySelector<HTMLElement>(".landing-header");

      // Header state (works with reduced motion; it only toggles attributes).
      ScrollTrigger.create({
        start: 0,
        end: "max",
        onUpdate: (self) => {
          if (!header) return;
          const y = self.scroll();
          header.dataset.scrolled = String(y > 24);
          header.dataset.hidden = String(
            self.direction === 1 && y > 640 && header.dataset.open !== "true",
          );
        },
      });

      if (reducedMotion()) return;

      gsap.to(".reading-progress", {
        scaleX: 1,
        ease: "none",
        scrollTrigger: { start: 0, end: "max", scrub: 0.3 },
      });

      // Masked character reveal for section headings.
      gsap.utils
        .toArray<HTMLElement>("[data-split]:not([data-split='hero'])")
        .forEach((heading) => {
          gsap.from(heading.querySelectorAll(".split-char"), {
            yPercent: 115,
            rotate: 5,
            stagger: 0.03,
            duration: 1.2,
            ease: SILK,
            clearProps: "transform",
            scrollTrigger: { trigger: heading, start: "top 88%", once: true },
          });
        });

      // Heavy fade-up with focus pull.
      ScrollTrigger.batch("[data-reveal]", {
        start: "top 92%",
        once: true,
        onEnter: (batch) =>
          gsap.fromTo(
            batch,
            { y: 64, autoAlpha: 0, filter: "blur(10px)" },
            {
              y: 0,
              autoAlpha: 1,
              filter: "blur(0px)",
              stagger: 0.08,
              duration: 1.2,
              ease: SILK,
              clearProps: "opacity,visibility,transform,filter",
            },
          ),
      });
      gsap.set(
        gsap.utils
          .toArray<HTMLElement>("[data-reveal]")
          .filter((el) => el.getBoundingClientRect().top > window.innerHeight),
        { autoAlpha: 0 },
      );

      // Manifesto lines light up character by character.
      gsap.utils.toArray<HTMLElement>("[data-scrub-text]").forEach((line) => {
        gsap.fromTo(
          line.querySelectorAll(".scrub-char"),
          { opacity: 0.12 },
          {
            opacity: 1,
            stagger: 0.08,
            ease: "none",
            scrollTrigger: {
              trigger: line,
              start: "top 82%",
              end: "bottom 58%",
              scrub: 0.4,
            },
          },
        );
      });

      // Manifesto: the lead settles, the route draws through each question
      // stop, and the rows slide out into their staircase.
      const manifesto = element.querySelector<HTMLElement>(".manifesto");
      if (manifesto) {
        const lead = manifesto.querySelector(".manifesto-lead");
        gsap.fromTo(
          manifesto.querySelector(".manifesto-lead > span:first-child"),
          { scale: 0.72, transformOrigin: "0% 100%" },
          {
            scale: 1,
            ease: "none",
            scrollTrigger: {
              trigger: lead,
              start: "top 92%",
              end: "top 45%",
              scrub: 0.6,
            },
          },
        );
        gsap.fromTo(
          manifesto.querySelector(".manifesto-lead-rest"),
          { xPercent: 40, autoAlpha: 0 },
          {
            xPercent: 0,
            autoAlpha: 1,
            ease: "none",
            scrollTrigger: {
              trigger: lead,
              start: "top 85%",
              end: "top 50%",
              scrub: 0.6,
            },
          },
        );
        const questions = manifesto.querySelector(".manifesto-questions");
        gsap.fromTo(
          questions,
          { "--trace": 0 },
          {
            "--trace": 1,
            ease: "none",
            scrollTrigger: {
              trigger: questions,
              start: "top 75%",
              end: "bottom 55%",
              scrub: 0.6,
            },
          },
        );
        gsap.utils
          .toArray<HTMLElement>(".manifesto-questions li", manifesto)
          .forEach((row) => {
            const text = row.querySelector<HTMLElement>(".manifesto-question");
            const indent = text
              ? Number.parseFloat(getComputedStyle(text).paddingLeft)
              : 0;
            const rowScroll = {
              trigger: row,
              start: "top 85%",
              end: "top 50%",
              scrub: 0.6,
            };
            gsap.fromTo(
              row,
              { "--draw": 0, "--lit": 0 },
              {
                "--draw": 1,
                "--lit": 1,
                ease: "none",
                scrollTrigger: rowScroll,
              },
            );
            if (text)
              gsap.fromTo(
                text,
                { x: -indent - 40 },
                { x: 0, ease: "none", scrollTrigger: rowScroll },
              );
          });
        const close = manifesto.querySelector(".manifesto-close");
        const closeScroll = {
          trigger: close,
          start: "top 90%",
          end: "top 60%",
          scrub: 0.6,
        };
        gsap.fromTo(
          manifesto.querySelector(".manifesto-close-line"),
          { scaleX: 0, transformOrigin: "100% 50%" },
          { scaleX: 1, ease: "none", scrollTrigger: closeScroll },
        );
        gsap.fromTo(
          manifesto.querySelector(".manifesto-close > span:last-child"),
          { x: 60 },
          { x: 0, ease: "none", scrollTrigger: closeScroll },
        );
      }

      // Hero: phones fan out and copy recedes as the reader leaves.
      const heroScroll = {
        trigger: ".hero",
        start: "top top",
        end: "bottom top",
        scrub: 0.5,
      };
      gsap.to("[data-hero-phone='left']", {
        xPercent: -18,
        rotate: -16,
        y: 60,
        ease: "none",
        scrollTrigger: heroScroll,
      });
      gsap.to("[data-hero-phone='right']", {
        xPercent: 18,
        rotate: 16,
        y: 60,
        ease: "none",
        scrollTrigger: heroScroll,
      });
      gsap.to("[data-hero-phone='center']", {
        y: -90,
        scale: 1.04,
        ease: "none",
        scrollTrigger: heroScroll,
      });
      gsap.to(".hero-copy", {
        y: 120,
        autoAlpha: 0.15,
        ease: "none",
        scrollTrigger: heroScroll,
      });
      gsap.to(".hero-orb-a", {
        yPercent: 40,
        ease: "none",
        scrollTrigger: heroScroll,
      });
      gsap.to(".hero-orb-b", {
        yPercent: -30,
        ease: "none",
        scrollTrigger: heroScroll,
      });

      // Route lines draw themselves into view.
      gsap.utils
        .toArray<SVGPathElement>("[data-route-line]")
        .forEach((path) => {
          gsap.fromTo(
            path,
            { strokeDasharray: 1, strokeDashoffset: 1 },
            {
              strokeDashoffset: 0,
              autoRound: false,
              duration: path.closest(".hero") ? 2.6 : 1.8,
              ease: "power3.inOut",
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
          trigger: ".closing",
          start: "top bottom",
          end: "bottom top",
          toggleActions: "play pause resume pause",
        },
      });

      // Numbers count up from zero.
      gsap.utils.toArray<HTMLElement>("[data-count]").forEach((counter) => {
        const target = Number(counter.dataset.count);
        const state = { value: 0 };
        gsap.to(state, {
          value: target,
          duration: 1.8,
          ease: "power3.out",
          scrollTrigger: { trigger: counter, start: "top 90%", once: true },
          onUpdate: () => {
            counter.textContent = String(Math.round(state.value));
          },
        });
      });

      // Screenshot drifts inside its frame.
      gsap.utils
        .toArray<HTMLElement>("[data-parallax-media]")
        .forEach((media) => {
          gsap.fromTo(
            media,
            { yPercent: -4, scale: 1.1 },
            {
              yPercent: 4,
              scale: 1.1,
              ease: "none",
              scrollTrigger: {
                trigger: media.parentElement,
                start: "top bottom",
                end: "bottom top",
                scrub: true,
              },
            },
          );
        });

      const media = gsap.matchMedia();
      // Pointer physics on precise pointers only.
      media.add("(hover: hover) and (pointer: fine)", () => {
        const preview = element.querySelector<HTMLElement>(".hero-preview");
        const hero = element.querySelector<HTMLElement>(".hero");
        if (preview) gsap.set(preview, { rotateX: 0, rotateY: 0 });
        const tilt = preview
          ? {
              x: gsap.quickTo(preview, "rotateY", {
                duration: 1.2,
                ease: "power3.out",
              }),
              y: gsap.quickTo(preview, "rotateX", {
                duration: 1.2,
                ease: "power3.out",
              }),
            }
          : null;
        const onHeroMove = (event: PointerEvent) => {
          if (!tilt || !hero) return;
          const box = hero.getBoundingClientRect();
          tilt.x(((event.clientX - box.left) / box.width - 0.5) * 10);
          tilt.y(-((event.clientY - box.top) / box.height - 0.5) * 8);
        };
        hero?.addEventListener("pointermove", onHeroMove);

        const magnets = gsap.utils
          .toArray<HTMLElement>("[data-magnetic]")
          .map((target) => {
            const x = gsap.quickTo(target, "x", {
              duration: 0.6,
              ease: "elastic.out(1, 0.45)",
            });
            const y = gsap.quickTo(target, "y", {
              duration: 0.6,
              ease: "elastic.out(1, 0.45)",
            });
            const move = (event: PointerEvent) => {
              const box = target.getBoundingClientRect();
              x((event.clientX - box.left - box.width / 2) * 0.22);
              y((event.clientY - box.top - box.height / 2) * 0.3);
            };
            const leave = () => {
              x(0);
              y(0);
            };
            target.addEventListener("pointermove", move);
            target.addEventListener("pointerleave", leave);
            return () => {
              target.removeEventListener("pointermove", move);
              target.removeEventListener("pointerleave", leave);
            };
          });

        const onSpotlight = (event: PointerEvent) => {
          if (!(event.target instanceof Element)) return;
          const card = event.target.closest<HTMLElement>("[data-spotlight]");
          if (!card) return;
          const box = card.getBoundingClientRect();
          card.style.setProperty("--mx", `${event.clientX - box.left}px`);
          card.style.setProperty("--my", `${event.clientY - box.top}px`);
        };
        element.addEventListener("pointermove", onSpotlight);
        return () => {
          hero?.removeEventListener("pointermove", onHeroMove);
          element.removeEventListener("pointermove", onSpotlight);
          for (const off of magnets) off();
        };
      });

      // FAQ answers glide in when opened.
      const onToggle = (event: Event) => {
        const details = event.target;
        if (!(details instanceof HTMLDetailsElement) || !details.open) return;
        gsap.fromTo(
          details.querySelector(".faq-answer"),
          { y: -12, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.7, ease: SILK, clearProps: "all" },
        );
      };
      element.addEventListener("toggle", onToggle, true);

      // Keyboard users never land on an invisible element.
      const showFocused = (event: FocusEvent) => {
        if (!(event.target instanceof Element)) return;
        const reveal = event.target.closest<HTMLElement>("[data-reveal]");
        if (reveal) {
          gsap.killTweensOf(reveal);
          gsap.set(reveal, {
            clearProps: "opacity,visibility,transform,filter",
          });
        }
      };
      element.addEventListener("focusin", showFocused);

      let resizeFrame = 0;
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(resizeFrame);
        resizeFrame = requestAnimationFrame(() => ScrollTrigger.refresh());
      });
      observer.observe(element);
      return () => {
        observer.disconnect();
        cancelAnimationFrame(resizeFrame);
        media.revert();
        element.removeEventListener("toggle", onToggle, true);
        element.removeEventListener("focusin", showFocused);
      };
    },
    { scope: root, dependencies: [intro], revertOnUpdate: true },
  );

  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
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
