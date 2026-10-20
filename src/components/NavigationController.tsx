"use client";

import { LocateFixed } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import useNavigation from "@/hook/useNavigation";
import { useAppTranslation } from "@/i18n/client";
import useMapStore from "@/stores/useMapStore";
import useNavStore from "@/stores/useNavStore";
import VenueArrivalTransition from "./Indoor/VenueArrivalTransition";
import VenueTourHUD from "./Indoor/VenueTourHUD";
import NavigationHUD from "./Navigation/NavigationHUD";

/**
 * Driver for the turn-by-turn engine plus the map-first navigation chrome
 * (instruction banner, ETA bar, proximity pills). Rendered (by ClientMap) only
 * while navigation is active, so mount = nav start and unmount = nav end.
 */
export default function NavigationController() {
  const venueStatus = useMapStore((s) => s.venueJourney?.guidance.status);
  if (venueStatus === "touring") return <VenueTourHUD />;
  if (venueStatus && venueStatus !== "outdoor") return null;
  return <OutdoorNavigationController />;
}

function OutdoorNavigationController() {
  useNavigation();
  const { t } = useAppTranslation();
  const followPaused = useNavStore((s) => s.followPaused);
  const setFollowPaused = useNavStore((s) => s.setFollowPaused);

  return (
    <div>
      <VenueArrivalTransition />
      <NavigationHUD />
      <AnimatePresence>
        {followPaused && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            onClick={() => setFollowPaused(false)}
            className="absolute left-1/2 -translate-x-1/2 bottom-[100px] z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-primary text-primary-foreground text-sm font-semibold shadow-xl hover:shadow-2xl transition-shadow pointer-events-auto"
          >
            <LocateFixed className="h-4 w-4" />
            {t("resumeFollow")}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
