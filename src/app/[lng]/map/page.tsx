"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import OnboardingHost from "@/components/Onboarding/OnboardingHost";
import Splash from "@/components/Splash";

const ClientMap = dynamic(() => import("@/components/ClientMap"), {
  ssr: false,
});

const SPLASH_MS = 2000;

export default function Home() {
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const id = window.setTimeout(() => setShowSplash(false), SPLASH_MS);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div className=" w-full h-full flex flex-col">
      <Splash show={showSplash} durationMs={SPLASH_MS} />
      <ClientMap />
      {/* Held back until the splash clears so the tour is never announced to a
          screen reader while it is still visually covered. */}
      <OnboardingHost ready={!showSplash} />
    </div>
  );
}
