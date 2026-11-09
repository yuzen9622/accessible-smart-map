"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Smartphone } from "lucide-react";
import { useRef } from "react";
import { Iphone } from "@/components/ui/iphone";
import AppStoreLink from "./AppStoreLink";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const screens = [
  {
    image: "explore-native",
    title: "附近設施，一眼找到",
    description: "從地圖查看電梯與周邊地點，依需要切換坡道、廁所和停車圖層。",
    alt: "原生 App 的臺北車站周邊地圖與設施篩選入口",
  },
  {
    image: "needs-native",
    title: "先說說你的通行需要",
    description: "輪椅、助行器或推嬰兒車，讓路線規劃考慮你的出行需求。",
    alt: "原生 App 無障礙需求設定，包含輪椅、助行器、視覺障礙與推嬰兒車選項",
  },
  {
    image: "navigation-live-native",
    title: "下一個轉彎，用聽的",
    description: "轉彎與距離即時語音播報，搭配畫面上的下一步及預計抵達時間。",
    alt: "原生 App 導航顯示 40 公尺後左轉、剩餘距離與即時語音播報",
  },
  {
    image: "bus-arrivals-native",
    title: "公車還有多久到？",
    description: "查看站牌的即時到站倒數，也能篩選無障礙公車。",
    alt: "原生 App 臺北車站忠孝站牌的公車到站資訊與無障礙篩選",
  },
  {
    image: "bus-route-native",
    title: "沿途站點，接著看",
    description: "確認行車方向與停靠站，從路線畫面設定到站提醒。",
    alt: "原生 App 265 區公車的行駛方向、沿途站點與到站提醒按鈕",
  },
  {
    image: "assistant-voice-native",
    video: "/landing/assistant-voice-native.mp4",
    title: "文字與語音助理",
    description: "用文字或語音說出需求，協助查詢地點、設施與路線。",
    alt: "原生 App 語音助理已連線並顯示聆聽中，包含原生波形、靜音與結束按鈕",
  },
];

export default function AppShowcase() {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const section = root.current;
      const stage = section?.querySelector<HTMLElement>(".app-stage");
      const gallery = section?.querySelector<HTMLElement>(".app-gallery");
      const track = section?.querySelector<HTMLElement>(".app-gallery-track");
      const card = track?.querySelector<HTMLElement>(".app-card");
      if (!section || !stage || !gallery || !track || !card) return;
      const media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        section.dataset.scrollReady = "true";
        const headerHeight = () =>
          document.querySelector(".landing-header")?.getBoundingClientRect()
            .height ?? 65;
        const fitCards = () => {
          section.style.setProperty(
            "--app-header-height",
            `${headerHeight()}px`,
          );
          const cardWidth = Math.min(330, gallery.clientWidth - 24);
          section.style.setProperty("--app-card-width", `${cardWidth}px`);
          const captionHeight = Math.max(
            ...Array.from(
              track.querySelectorAll("figcaption"),
              (caption) => caption.getBoundingClientRect().height,
            ),
          );
          const trackStyle = getComputedStyle(track);
          const cardStyle = getComputedStyle(card);
          const availableHeight =
            gallery.clientHeight -
            Number.parseFloat(trackStyle.paddingTop) -
            Number.parseFloat(trackStyle.paddingBottom) -
            Number.parseFloat(cardStyle.rowGap) -
            captionHeight;
          section.style.setProperty(
            "--app-caption-height",
            `${captionHeight}px`,
          );
          section.style.setProperty(
            "--app-phone-width",
            `${Math.max(0, Math.min(cardWidth, availableHeight * (433 / 882)))}px`,
          );
        };
        const distance = () =>
          Math.max(0, track.scrollWidth - gallery.clientWidth);
        fitCards();
        gsap.to(track, {
          x: () => -distance(),
          ease: "none",
          scrollTrigger: {
            trigger: stage,
            pin: stage,
            start: () => `top ${headerHeight()}px`,
            end: () => `+=${Math.max(distance(), window.innerHeight * 0.8)}`,
            scrub: true,
            invalidateOnRefresh: true,
            onRefreshInit: fitCards,
          },
        });
        let frame = 0;
        const observer = new ResizeObserver(() => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => ScrollTrigger.refresh());
        });
        observer.observe(gallery);
        track.querySelectorAll("figcaption").forEach((caption) => {
          observer.observe(caption);
        });
        return () => {
          observer.disconnect();
          cancelAnimationFrame(frame);
          delete section.dataset.scrollReady;
          for (const property of [
            "--app-header-height",
            "--app-card-width",
            "--app-phone-width",
            "--app-caption-height",
          ])
            section.style.removeProperty(property);
        };
      });
      return () => media.revert();
    },
    { scope: root },
  );
  return (
    <section
      className="app-section"
      id="app"
      aria-labelledby="app-title"
      ref={root}
    >
      <div className="app-stage landing-container">
        <div className="app-section-heading">
          <div>
            <p className="eyebrow">
              <Smartphone size={18} aria-hidden="true" />
              無障礙智慧地圖 App
            </p>
            <h2 id="app-title">把出門需要的，放進口袋</h2>
          </div>
          <div className="app-heading-actions">
            <AppStoreLink />
          </div>
        </div>
        <section className="app-gallery" aria-label="App 功能截圖">
          <ul className="app-gallery-track">
            {screens.map((screen) => (
              <li key={screen.image}>
                <figure className="app-card">
                  <div className="app-phone-container">
                    <Iphone
                      src={`/landing/${screen.image}.webp`}
                      videoSrc={screen.video}
                      alt={screen.alt}
                      className="app-iphone"
                    />
                  </div>
                  <figcaption>
                    <h3>{screen.title}</h3>
                    <p>{screen.description}</p>
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </section>
  );
}
