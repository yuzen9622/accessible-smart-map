"use client";

import { ArrowUpRight } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import Image from "./LandingImage";

const links = [
  ["#app", "App 介紹", "六個實際畫面"],
  ["#features", "路線規劃", "一般、輪椅與大眾運輸"],
  ["#terrain", "路線細節", "人行道與坡度"],
  ["#journey", "出行幫手", "語音導航與即時公車"],
  ["#everyday", "更多功能", "設施、天氣、回報與 SOS"],
  ["#faq", "常見問題", "圖資與通行限制"],
];

export default function LandingNav() {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      root.style.overflow = overflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <header className="landing-header" data-open={open}>
      <div className="nav-island">
        <a
          href="/"
          className="brand"
          aria-label="無障礙智慧地圖 Accessible Smart Map 首頁"
        >
          <Image src="/logo.webp" width={32} height={32} alt="" />
          <span>無障礙智慧地圖</span>
        </a>
        <nav className="desktop-nav" aria-label="主要導覽">
          {links.slice(0, 5).map(([href, label]) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
        </nav>
        <a className="nav-cta" href="/map/">
          開啟地圖
          <span aria-hidden="true">
            <ArrowUpRight size={14} strokeWidth={1.5} />
          </span>
        </a>
        <button
          className="nav-toggle"
          type="button"
          ref={toggle}
          aria-expanded={open}
          aria-controls="mobile-navigation"
          aria-label={open ? "關閉導覽" : "開啟導覽"}
          onClick={() => setOpen(!open)}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>
        <div className="reading-progress" aria-hidden="true" />
      </div>
      <div
        className="nav-overlay"
        id="mobile-navigation"
        aria-hidden={!open}
        inert={!open}
      >
        <nav aria-label="手機導覽">
          <ol>
            {links.map(([href, label, note], index) => (
              <li key={href} style={{ "--i": index } as CSSProperties}>
                <a href={href} onClick={() => setOpen(false)}>
                  <span>{label}</span>
                  <em>{note}</em>
                </a>
              </li>
            ))}
          </ol>
          <a
            className="nav-overlay-cta"
            href="/map/"
            style={{ "--i": links.length } as CSSProperties}
          >
            開啟地圖
            <span aria-hidden="true">
              <ArrowUpRight size={18} strokeWidth={1.5} />
            </span>
          </a>
        </nav>
      </div>
    </header>
  );
}
