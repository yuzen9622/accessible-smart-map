"use client";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import useReducedMotion from "@/hook/useReducedMotion";
import { useAppTranslation } from "@/i18n/client";

type SplashProps = {
  show?: boolean;
  /**
   * How long the splash is scheduled to stay up, in ms. Drives the progress
   * bar so it finishes exactly when the splash does — a determinate bar is
   * only honest if it tracks a duration we actually know.
   */
  durationMs?: number;
};

export default function Splash({
  show = true,
  durationMs = 2000,
}: SplashProps) {
  const { t } = useAppTranslation("translation");
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="pointer-events-none fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-8 bg-background"
          aria-hidden="true"
        >
          <div className="flex flex-col items-center gap-4 px-6 text-center">
            <motion.div
              initial={{ opacity: 0 }}
              animate={
                reduceMotion ? { opacity: 1 } : { opacity: 1, scale: [0.8, 1] }
              }
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <Image
                src="/app-icon.webp"
                alt={t("title")}
                width={96}
                height={96}
                className="rounded-[22px]"
                draggable={false}
                priority
              />
            </motion.div>

            <motion.h1
              initial={{ opacity: 0 }}
              animate={
                reduceMotion ? { opacity: 1 } : { opacity: 1, y: [8, 0] }
              }
              transition={{ delay: 0.2, duration: 0.4, ease: "easeOut" }}
              className="text-[28px] leading-tight font-bold sm:text-[34px]"
            >
              {t("title")}
            </motion.h1>

            {/* The one line that tells a first-time visitor what this is. */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={
                reduceMotion ? { opacity: 1 } : { opacity: 1, y: [8, 0] }
              }
              transition={{ delay: 0.4, duration: 0.4, ease: "easeOut" }}
              className="text-sm text-muted-foreground sm:text-base"
            >
              {t("tagline")}
            </motion.p>
          </div>

          {!reduceMotion && (
            <div className="h-1 w-32 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: durationMs / 1000, ease: "linear" }}
              />
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
