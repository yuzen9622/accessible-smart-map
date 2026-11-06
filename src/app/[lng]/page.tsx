"use client";

import { useEffect } from "react";
import { fallbackLng, languages } from "@/i18n/setting";

// Also works in native static exports, where middleware is unavailable.
export default function LegacyMapPage() {
  useEffect(() => {
    const segment = window.location.pathname.split("/")[1];
    const lng = languages.includes(segment) ? segment : fallbackLng;
    const native = ["capacitor:", "ionic:"].includes(window.location.protocol);
    window.location.replace(
      `/${lng}/map/${native ? "index.html" : ""}${window.location.search}${window.location.hash}`,
    );
  }, []);
  return null;
}
