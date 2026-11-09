"use client";

import { Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

const links = [
  ["#app", "App 介紹"],
  ["#features", "路線規劃"],
  ["#journey", "出行幫手"],
  ["#everyday", "更多功能"],
  ["#faq", "常見問題"],
];

export default function LandingNav() {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        menu.current?.focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);
  return (
    <div className="landing-nav">
      <nav className="desktop-nav" aria-label="主要導覽">
        {links.map(([href, label]) => (
          <a key={href} href={href}>
            {label}
          </a>
        ))}
      </nav>
      <button
        className="icon-button mobile-menu-button"
        type="button"
        ref={menu}
        aria-expanded={open}
        aria-controls="mobile-navigation"
        aria-label={open ? "關閉導覽" : "開啟導覽"}
        onClick={() => setOpen(!open)}
      >
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
      <AnimatePresence>
        {open && (
          <motion.nav
            key="menu"
            id="mobile-navigation"
            className="mobile-nav"
            aria-label="手機導覽"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            {links.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setOpen(false)}>
                {label}
              </a>
            ))}
          </motion.nav>
        )}
      </AnimatePresence>
    </div>
  );
}
