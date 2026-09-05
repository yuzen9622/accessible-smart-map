"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import { VisualViewportSync } from "@/components/layout/VisualViewportSync";
import CoachMarks from "@/components/Onboarding/CoachMarks";
import KeyboardShortcuts from "@/components/shared/KeyboardShortcuts";
import SkipNavLink from "@/components/shared/SkipNavLink";
import { refreshToken } from "@/lib/api/auth";
import { getUserInfo } from "@/lib/api/user";
import { migrateLegacyPlaceStorage } from "@/lib/place/adapters";
import useAuthStore from "@/stores/useAuthStore";
import useChatStore from "@/stores/useChatStore";
import useMapStore, { type SavedPlaceCategory } from "@/stores/useMapStore";
import useOnboardingStore from "@/stores/useOnboardingStore";
import useQuickActionsStore from "@/stores/useQuickActionsStore";

// Routes that render as a bare, centered page (their own `StatusPage` card)
// instead of being nested inside the map app shell. These are landed on cold
// from an external link (a password-reset email) — showing the search
// panel / side rail / onboarding card behind them made no sense and visually
// overlapped, since the map app underneath was never actually initialized
// for this visit (no location, no session context to speak of yet).
const BARE_ROUTE_SEGMENTS = ["reset-password"];

function isBareRoute(pathname: string) {
  // pathname is like "/zh-TW/reset-password" — segment [1] is the locale,
  // [2] is the route we actually care about.
  const segment = pathname.split("/")[2];
  return !!segment && BARE_ROUTE_SEGMENTS.includes(segment);
}

export default function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const bare = isBareRoute(pathname);
  const { initSearchHistory, initSavedPlaces, initSavedPlaceCategories } =
    useMapStore(
      useShallow((s) => ({
        initSearchHistory: s.initSearchHistory,
        initSavedPlaces: s.initSavedPlaces,
        initSavedPlaceCategories: s.initSavedPlaceCategories,
      })),
    );
  const { setSession, setUser, setUserConfig } = useAuthStore(
    useShallow((s) => ({
      setSession: s.setSession,
      setUser: s.setUser,
      setUserConfig: s.setUserConfig,
    })),
  );
  const getNewAccessToken = useCallback(async () => {
    const token = await refreshToken();
    if (token) {
      setSession({ accessToken: token });
      const { data } = await getUserInfo();
      if (data?.user) setUser(data.user);
      if (data?.config) {
        setUserConfig(data.config);
      }
    }
  }, [setSession, setUser, setUserConfig]);

  // Read the onboarding flags and accessibility profile out of localStorage
  // after mount. Every consumer gates on the store's `hydrated` flag, so this
  // runs before anything can decide to show or hide a one-time guide.
  const initOnboarding = useOnboardingStore((s) => s.initFromStorage);
  useEffect(() => {
    initOnboarding();
  }, [initOnboarding]);

  // §6.1 of the UX audit: the global a11y filter is shareable via
  // `?a11y=1` — read it once on mount (window.location.search directly,
  // not useSearchParams, so this doesn't need a Suspense boundary). The
  // toggle itself (HomeContent) is what writes the query param back when
  // the user flips it, this only ever reads.
  const setA11yFilterEnabled = useMapStore((s) => s.setA11yFilterEnabled);
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only URL read, see comment above
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("a11y") === "1") {
      setA11yFilterEnabled(true);
    }
  }, []);

  // Restores the AI chat conversation from sessionStorage (if any) before the
  // chat panel ever mounts — by the time a user opens it, `useAIChat`'s
  // empty-check for the greeting is reading post-hydration state.
  const initChat = useChatStore((s) => s.initFromStorage);
  useEffect(() => {
    initChat();
  }, [initChat]);

  const initQuickActions = useQuickActionsStore((s) => s.initFromStorage);
  useEffect(() => {
    initQuickActions();
  }, [initQuickActions]);

  useEffect(() => {
    const storedHistory = localStorage.getItem("searchHistory");
    const storedSaved = localStorage.getItem("savedPlaces");
    const storedCats = localStorage.getItem("savedPlaceCategories");
    const storedVersion = localStorage.getItem("placeSchemaVersion");
    getNewAccessToken();

    if (storedVersion === "2") {
      try {
        initSearchHistory(storedHistory ? JSON.parse(storedHistory) : []);
        initSavedPlaces(storedSaved ? JSON.parse(storedSaved) : []);
        initSavedPlaceCategories(storedCats ? JSON.parse(storedCats) : {});
      } catch {
        // Ignore corrupted versioned caches without changing their version.
      }
      return;
    }

    try {
      const migrated = migrateLegacyPlaceStorage({
        searchHistory: storedHistory ? JSON.parse(storedHistory) : [],
        savedPlaces: storedSaved ? JSON.parse(storedSaved) : [],
        savedPlaceCategories: storedCats ? JSON.parse(storedCats) : {},
      });
      const nextHistory = JSON.stringify(migrated.searchHistory);
      const nextSaved = JSON.stringify(migrated.savedPlaces);
      const nextCategories = JSON.stringify(migrated.savedPlaceCategories);
      const restoreStoredValue = (key: string, value: string | null) => {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      };

      // Complete conversion before the first write; set the version only after
      // all three data keys have been persisted.
      try {
        localStorage.setItem("searchHistory", nextHistory);
        localStorage.setItem("savedPlaces", nextSaved);
        localStorage.setItem("savedPlaceCategories", nextCategories);
        localStorage.setItem("placeSchemaVersion", "2");
      } catch (error) {
        try {
          restoreStoredValue("searchHistory", storedHistory);
          restoreStoredValue("savedPlaces", storedSaved);
          restoreStoredValue("savedPlaceCategories", storedCats);
          restoreStoredValue("placeSchemaVersion", storedVersion);
        } catch {
          // A storage quota failure can also prevent rollback writes.
        }
        throw error;
      }

      initSearchHistory(migrated.searchHistory);
      initSavedPlaces(migrated.savedPlaces);
      initSavedPlaceCategories(
        migrated.savedPlaceCategories as Record<string, SavedPlaceCategory>,
      );
    } catch {
      // Keep the old keys and version untouched so migration retries next load.
    }
  }, [
    initSearchHistory,
    initSavedPlaces,
    initSavedPlaceCategories,
    getNewAccessToken,
  ]);

  if (bare) {
    // `main`/`role="main"` for the landmark a screen reader user expects on
    // any page — `className="contents"` so it doesn't impose its own layout
    // on top of the StatusPage card, which already centers itself full-page.
    return <main className="contents">{children}</main>;
  }

  return (
    <div
      className="w-full flex flex-col"
      style={{ height: "var(--vvh, 100dvh)" }}
    >
      <VisualViewportSync />
      <SkipNavLink />
      <main id="main-map" className="flex-1 relative" aria-label="Map">
        {children}
      </main>
      <BottomSheet />
      <CoachMarks />
      <KeyboardShortcuts />
    </div>
  );
}
