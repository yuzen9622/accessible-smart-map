"use client";

import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { Flip } from "gsap/Flip";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { BusFront, MessageCircle, Volume2 } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { Iphone } from "@/components/ui/iphone";
import BusPreview from "./BusPreview";
import Image from "./LandingImage";
import { SplitLine } from "./LandingUI";

gsap.registerPlugin(useGSAP, ScrollTrigger, Flip);

const thin = { strokeWidth: 1.4, "aria-hidden": true } as const;

type Card = {
  icon: typeof Volume2;
  title: [string, string];
  description: string;
  points?: string[];
  visual: ReactNode;
};

const cards: Card[] = [
  {
    icon: Volume2,
    title: ["語音導航", "轉彎用聽的"],
    description:
      "開啟語音播報，聽取轉彎與距離指引。導航隨位置更新，畫面同步顯示下一步與預計抵達時間。",
    points: [
      "逐步轉彎與距離播報",
      "隨位置更新導航進度",
      "剩餘距離與預計抵達時間",
    ],
    visual: (
      <div className="journey-phone">
        <Iphone
          src="/landing/navigation-live-native.webp"
          alt="iPhone 原生 App 正式導航畫面，顯示左轉距離、目前位置及即時語音導航"
        />
      </div>
    ),
  },
  {
    icon: BusFront,
    title: ["即時公車", "知道還要等多久"],
    description:
      "找附近站牌或輸入路線，查看到站倒數與沿途站序。需要搭無障礙公車時，也能切換篩選。",
    points: [
      "即時到站時間與進站狀態",
      "無障礙公車篩選",
      "車快到時提醒、查看沿途站點",
    ],
    visual: <BusPreview />,
  },
  {
    icon: MessageCircle,
    title: ["語音助理", "把問題說出來"],
    description:
      "用文字或語音說出需求，請語音助理找地點、規劃路線，或問清楚哪一站下車、出站後還要走多遠。",
    visual: (
      <figure className="journey-shot">
        <Image
          width={1440}
          height={1000}
          src="/landing/assistant-desktop.webp"
          alt="助理回答台北 101 行程的下車站與出站後步行距離"
          sizes="(max-width: 767px) 92vw, 56vw"
        />
      </figure>
    ),
  },
];

/**
 * Desktop: the deck pins, cards slide over one another, then the finished
 * stack opens into a left / centre / right overview. Elsewhere it is a list.
 */
export default function JourneyDeck() {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const section = root.current;
      const stage = section?.querySelector<HTMLElement>(".journey-stage");
      const deck = section?.querySelector<HTMLElement>(".journey-deck");
      if (!section || !stage || !deck) return;
      const items = gsap.utils.toArray<HTMLElement>(".journey-card", deck);
      const media = gsap.matchMedia();

      media.add(
        "(min-width: 1024px) and (min-height: 720px) and (prefers-reduced-motion: no-preference)",
        () => {
          section.dataset.mode = "stack";
          // Each new card rises from below and pushes the earlier ones up
          // into a layered deck; the overview opens as the last one lands.
          const stack = gsap.timeline({ defaults: { ease: "none" } });
          items.slice(1).forEach((card, i) => {
            stack.fromTo(
              card.querySelector(".bezel"),
              { yPercent: 112 },
              { yPercent: 0, duration: 1 },
              i,
            );
            items.slice(0, i + 1).forEach((earlier, j) => {
              stack.fromTo(
                earlier,
                { "--recede": i - j },
                { "--recede": i - j + 1, duration: 1 },
                i,
              );
            });
          });
          const stackEnd = stack.duration();
          // A short tail keeps the overview on screen before the pin releases.
          stack.to({}, { duration: 0.7 });
          const spreadAt = (stackEnd - 0.03) / stack.duration();

          let spread = false;
          const setSpread = (next: boolean) => {
            if (next === spread) return;
            spread = next;
            const contents = deck.querySelectorAll(
              ".journey-text, .journey-visual",
            );
            const state = Flip.getState(items);
            deck.classList.toggle("is-spread", next);
            Flip.from(state, {
              duration: 1.1,
              ease: "expo.inOut",
              stagger: 0.05,
              absolute: true,
            });
            gsap.fromTo(
              contents,
              { autoAlpha: 0, y: 24 },
              {
                autoAlpha: 1,
                y: 0,
                duration: 0.8,
                delay: 0.45,
                stagger: 0.04,
                ease: "expo.out",
                clearProps: "opacity,visibility,transform",
              },
            );
          };

          ScrollTrigger.create({
            trigger: stage,
            pin: stage,
            start: "top top",
            end: () => `+=${window.innerHeight * 2.4}`,
            scrub: 0.5,
            animation: stack,
            invalidateOnRefresh: true,
            onUpdate: (self) => setSpread(self.progress >= spreadAt),
          });

          return () => {
            delete section.dataset.mode;
            deck.classList.remove("is-spread");
            gsap.set(items, { clearProps: "--recede" });
          };
        },
      );

      // Reduced motion on desktop: skip the choreography, show the overview.
      media.add(
        "(min-width: 1024px) and (prefers-reduced-motion: reduce)",
        () => {
          section.dataset.mode = "overview";
          deck.classList.add("is-spread");
          return () => {
            delete section.dataset.mode;
            deck.classList.remove("is-spread");
          };
        },
      );

      return () => media.revert();
    },
    { scope: root },
  );

  return (
    <section
      className="section journey-section"
      id="journey"
      aria-labelledby="journey-title"
      ref={root}
    >
      <div className="section-heading landing-container">
        <h2 id="journey-title" data-split>
          <SplitLine text="聽指引、看公車" />
          <SplitLine text="路上都有幫手" className="display-accent" />
        </h2>
        <p data-reveal>語音導航、即時到站與語音助理，從規劃一路用到抵達。</p>
      </div>
      <div className="journey-stage landing-container">
        <div className="journey-deck">
          {cards.map((card) => (
            <article className="journey-card" key={card.title[0]}>
              <div className="bezel">
                <div className="bezel-core journey-core">
                  <div className="journey-text">
                    <span className="journey-icon">
                      <card.icon size={22} {...thin} />
                    </span>
                    <h3>
                      <span>{card.title[0]}</span>
                      <span>{card.title[1]}</span>
                    </h3>
                    <p>{card.description}</p>
                    {card.points && (
                      <ul className="journey-points">
                        {card.points.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="journey-visual">{card.visual}</div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
