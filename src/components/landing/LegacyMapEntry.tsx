"use client";

import { useEffect } from "react";

/** Preserve fragment-only SOS links and the existing native asset-router entry. */
export default function LegacyMapEntry() {
  useEffect(() => {
    const native =
      window.location.protocol === "capacitor:" ||
      window.location.protocol === "ionic:";
    const token = new URLSearchParams(window.location.hash.slice(1)).has(
      "token",
    );
    if (native || token) {
      const target = native ? "/zh-TW/map/index.html" : "/map/";
      window.location.replace(
        `${target}${window.location.search}${window.location.hash}`,
      );
    }
  }, []);
  return null;
}
