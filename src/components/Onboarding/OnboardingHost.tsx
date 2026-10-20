"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import useOnboardingStore from "@/stores/useOnboardingStore";

const OnboardingFlow = dynamic(() => import("./OnboardingFlow"), {
  ssr: false,
});

/**
 * URL parameters that mean the user arrived with a specific intent rather than
 * to explore: an SOS tracking link, a LINE session hand-off, a shared location,
 * or a deep link to a place. Blocking any of those behind a four-step tour
 * would be actively harmful — someone opening an SOS link is trying to find a
 * person right now.
 */
const DEEP_LINK_PARAMS = [
  "sos",
  "planToken",
  "sessionId",
  "liff.state",
  "loc",
  "place",
];

function arrivedViaDeepLink() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return DEEP_LINK_PARAMS.some((key) => params.has(key));
}

/**
 * Decides whether the first-run tour should show. Mounted from the home page
 * (not the shared layout) for two reasons: the tour teaches the map UI, so it
 * has no business appearing on `/reset-password` or `/verify-email`; and the
 * home page already owns the splash lifecycle, so gating on `ready` keeps the
 * tour from rendering underneath the splash instead of guessing at its timer.
 */
export default function OnboardingHost({ ready }: { ready: boolean }) {
  const { hydrated, onboarding } = useOnboardingStore(
    useShallow((s) => ({ hydrated: s.hydrated, onboarding: s.onboarding })),
  );
  const [deepLink, setDeepLink] = useState(true);

  // Read the query string after mount only; during SSR there is no location,
  // and defaulting to "deep link" keeps the tour from flashing before we know.
  useEffect(() => {
    setDeepLink(arrivedViaDeepLink());
  }, []);

  const shouldShow = ready && hydrated && !deepLink && onboarding === null;
  if (!shouldShow) return null;

  return <OnboardingFlow />;
}
