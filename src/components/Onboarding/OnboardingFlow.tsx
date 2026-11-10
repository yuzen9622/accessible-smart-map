"use client";

import {
  CheckIcon,
  ChevronLeftIcon,
  MapPinIcon,
} from "@animateicons/react/lucide";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Accessibility,
  Baby,
  Eye,
  HeartHandshake,
  Navigation,
  PersonStanding,
  Sparkles,
  Timer,
  Toilet,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Image from "next/image";
import { useCallback, useId, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import useReducedMotion from "@/hook/useReducedMotion";
import { useAppTranslation } from "@/i18n/client";
import { cn } from "@/lib/utils";
import useMapStore from "@/stores/useMapStore";
import useOnboardingStore from "@/stores/useOnboardingStore";
import {
  A11Y_SITUATIONS,
  type A11ySituation,
  defaultFacilityCategories,
  FACILITY_CATEGORY_TO_A11Y_ENUM,
  ROUTE_MODE_LABEL_KEY,
} from "@/types/a11yProfile";

/** Step order; also the stable keys for the progress dots. */
const STEP_IDS = ["intro", "needs", "location", "done"] as const;
const TOTAL_STEPS = STEP_IDS.length;

const SITUATION_ICONS: Record<
  A11ySituation,
  React.ComponentType<{ className?: string }>
> = {
  wheelchair: Accessibility,
  walker: PersonStanding,
  vision: Eye,
  slow: Timer,
  stroller: Baby,
  companion: HeartHandshake,
};

type LocationState =
  | "idle"
  | "requesting"
  | "granted"
  | "denied"
  | "unsupported";

export default function OnboardingFlow() {
  const { t } = useAppTranslation();
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const [step, setStep] = useState(0);
  const [locationState, setLocationState] = useState<LocationState>("idle");

  const {
    profile,
    toggleSituation,
    completeOnboarding,
    skipOnboarding,
    dismissWelcomeCard,
  } = useOnboardingStore(
    useShallow((s) => ({
      profile: s.profile,
      toggleSituation: s.toggleSituation,
      completeOnboarding: s.completeOnboarding,
      skipOnboarding: s.skipOnboarding,
      dismissWelcomeCard: s.dismissWelcomeCard,
    })),
  );

  const {
    setUserLocation,
    setActiveRailPanel,
    setSheetMode,
    setChatOpen,
    setSelectedA11yTypes,
  } = useMapStore(
    useShallow((s) => ({
      setUserLocation: s.setUserLocation,
      setActiveRailPanel: s.setActiveRailPanel,
      setSheetMode: s.setSheetMode,
      setChatOpen: s.setChatOpen,
      setSelectedA11yTypes: s.setSelectedA11yTypes,
    })),
  );

  // Writing the record is what unmounts this component (see OnboardingHost),
  // so none of these handlers need an explicit close callback.
  const handleSkip = useCallback(() => {
    skipOnboarding();
  }, [skipOnboarding]);

  /**
   * Pre-select the map's facility filter to match what step 2 says the user
   * needs, so they land on a map that already shows the right pins instead of
   * an empty one waiting for a manual toggle. Only applies the default when
   * the map filter is still untouched (empty) and the user actually picked a
   * situation — skipping onboarding or answering nothing must not silently
   * turn filters on behind someone's back.
   */
  const applyDefaultFacilityFilter = useCallback(() => {
    const { situations } = useOnboardingStore.getState().profile;
    if (situations.length === 0) return;
    if (useMapStore.getState().selectedA11yTypes.size > 0) return;
    const categories = defaultFacilityCategories(situations);
    setSelectedA11yTypes(
      new Set(categories.map((c) => FACILITY_CATEGORY_TO_A11Y_ENUM[c])),
    );
  }, [setSelectedA11yTypes]);

  const finish = useCallback(() => {
    applyDefaultFacilityFilter();
    completeOnboarding();
  }, [applyDefaultFacilityFilter, completeOnboarding]);

  /**
   * Step 4's three cards must land the user *inside* the feature, not next to
   * it — the first successful use is what decides whether they come back. Each
   * one closes onboarding and leaves the app in the state that feature needs.
   * The welcome card is dismissed too: someone who just followed a suggestion
   * does not also need to be told where the search bar is.
   */
  const runSuggestion = useCallback(
    (suggestion: "toilet" | "route" | "ai") => {
      applyDefaultFacilityFilter();
      completeOnboarding();
      dismissWelcomeCard();
      if (suggestion === "toilet") {
        setSheetMode("home");
        setActiveRailPanel("a11y");
      } else if (suggestion === "route") {
        setSheetMode("plan");
      } else {
        setChatOpen(true);
      }
    },
    [
      applyDefaultFacilityFilter,
      completeOnboarding,
      dismissWelcomeCard,
      setSheetMode,
      setActiveRailPanel,
      setChatOpen,
    ],
  );

  const requestLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationState("unsupported");
      return;
    }
    setLocationState("requesting");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUserLocation(loc);
        try {
          localStorage.setItem("lastUserLocation", JSON.stringify(loc));
        } catch {
          // A cache write failure only costs a slower next cold start.
        }
        setLocationState("granted");
      },
      () => {
        // Denied or timed out: both leave the user without a fix, and both are
        // recoverable by entering a location manually, so they read the same.
        setLocationState("denied");
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 },
    );
  }, [setUserLocation]);

  const modeLabel = t(ROUTE_MODE_LABEL_KEY[profile.routeMode]);

  const stepTitles = useMemo(
    () => [
      t("onboarding.intro.title"),
      t("onboarding.needs.title"),
      t("onboarding.location.title"),
      t("onboarding.done.title"),
    ],
    [t],
  );

  const transition = reduceMotion
    ? { duration: 0 }
    : { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const };

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(next) => {
        // Radix routes Esc and outside-clicks through here. Esc means skip.
        if (!next) handleSkip();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-labelledby={titleId}
          aria-describedby={undefined}
          onPointerDownOutside={(e) => e.preventDefault()}
          className="fixed inset-0 z-(--z-onboarding) flex flex-col bg-background focus:outline-none"
        >
          <DialogPrimitive.Title id={titleId} className="sr-only">
            {t("onboarding.ariaTitle")}
          </DialogPrimitive.Title>

          {/* Announce each step to screen readers, and tell them Esc works —
              a keyboard user must never feel trapped in a tour. */}
          <div aria-live="polite" className="sr-only">
            {t("onboarding.stepOf", { current: step + 1, total: TOTAL_STEPS })}
            {". "}
            {stepTitles[step]}
            {". "}
            {t("onboarding.escHint")}
          </div>

          <header className="flex shrink-0 items-center justify-between px-4 py-3">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="flex h-11 items-center gap-1 rounded-xl px-2 text-sm text-muted-foreground transition-colors hover:bg-muted"
              >
                <ChevronLeftIcon size={16} />
                {t("onboarding.back")}
              </button>
            ) : (
              <span className="h-11" />
            )}
            <button
              type="button"
              onClick={handleSkip}
              className="flex h-11 items-center rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              {t("onboarding.skip")}
            </button>
          </header>

          <div className="flex flex-1 items-center justify-center overflow-y-auto px-5 pb-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -12 }}
                transition={transition}
                className="w-full max-w-md"
              >
                {step === 0 && (
                  <IntroStep
                    onStart={() => setStep(1)}
                    onBrowse={handleSkip}
                    t={t}
                  />
                )}
                {step === 1 && (
                  <NeedsStep
                    selected={profile.situations}
                    onToggle={toggleSituation}
                    modeLabel={modeLabel}
                    onNext={() => setStep(2)}
                    t={t}
                  />
                )}
                {step === 2 && (
                  <LocationStep
                    state={locationState}
                    onRequest={requestLocation}
                    onNext={() => setStep(3)}
                    t={t}
                  />
                )}
                {step === 3 && (
                  <DoneStep onRun={runSuggestion} onStart={finish} t={t} />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <footer
            className="flex shrink-0 items-center justify-center gap-2 pb-8"
            aria-hidden="true"
          >
            {STEP_IDS.map((id, i) => (
              <span
                key={id}
                className={cn(
                  "h-2 rounded-full transition-all",
                  i === step ? "w-6 bg-primary" : "w-2 bg-muted-foreground/30",
                )}
              />
            ))}
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

type Translate = ReturnType<typeof useAppTranslation>["t"];

function IntroStep({
  onStart,
  onBrowse,
  t,
}: {
  onStart: () => void;
  onBrowse: () => void;
  t: Translate;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative mb-8 h-28 w-28 overflow-hidden rounded-3xl shadow-sm">
        <Image
          src="/app-icon.webp"
          alt=""
          fill
          sizes="112px"
          draggable={false}
          priority
        />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">
        {t("onboarding.intro.title")}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">
        {t("onboarding.intro.body")}
      </p>
      <Button size="lg" className="mt-8 h-12 w-full" onClick={onStart}>
        {t("onboarding.intro.start")}
      </Button>
      <button
        type="button"
        onClick={onBrowse}
        className="mt-3 h-11 px-4 text-sm text-muted-foreground hover:underline"
      >
        {t("onboarding.intro.browse")}
      </button>
    </div>
  );
}

function NeedsStep({
  selected,
  onToggle,
  modeLabel,
  onNext,
  t,
}: {
  selected: A11ySituation[];
  onToggle: (s: A11ySituation) => void;
  modeLabel: string;
  onNext: () => void;
  t: Translate;
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">
        {t("onboarding.needs.title")}
      </h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {t("onboarding.needs.subtitle")}
      </p>

      <div className="mt-6 grid grid-cols-2 gap-2.5">
        {A11Y_SITUATIONS.map((id) => {
          const Icon = SITUATION_ICONS[id];
          const active = selected.includes(id);
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(id)}
              className={cn(
                "relative flex min-h-[104px] flex-col items-start gap-2 rounded-2xl border p-3.5 text-left transition-colors",
                active
                  ? "border-primary bg-primary/5"
                  : "border-border bg-card hover:bg-muted/60",
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-xl",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {active ? (
                  <CheckIcon size={18} />
                ) : (
                  <Icon className="h-4.5 w-4.5" />
                )}
              </span>
              <span className="text-sm font-semibold leading-tight">
                {t(`onboarding.situation.${id}`)}
              </span>
              <span className="text-xs leading-snug text-muted-foreground">
                {t(`onboarding.situation.${id}Desc`)}
              </span>
            </button>
          );
        })}
      </div>

      {/* Show the derived backend route mode instead of hiding the mapping.
          Six checkboxes collapse into four modes, and the user deserves to see
          which one they just landed on. */}
      {selected.length > 0 && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Navigation className="h-3.5 w-3.5 shrink-0 text-primary" />
          {t("onboarding.needs.derivedMode", { mode: modeLabel })}
        </p>
      )}

      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
        {t("onboarding.needs.hint")}
      </p>
      <Button size="lg" className="mt-4 h-12 w-full" onClick={onNext}>
        {t("onboarding.next")}
      </Button>
    </div>
  );
}

function LocationStep({
  state,
  onRequest,
  onNext,
  t,
}: {
  state: LocationState;
  onRequest: () => void;
  onNext: () => void;
  t: Translate;
}) {
  const resolved =
    state === "granted" || state === "denied" || state === "unsupported";
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-7 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10">
        <MapPinIcon size={36} className="text-primary" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">
        {t("onboarding.location.title")}
      </h1>

      <ul className="mt-6 w-full space-y-2.5 text-left">
        {["benefit1", "benefit2", "benefit3"].map((key) => (
          <li key={key} className="flex items-start gap-2.5">
            <CheckIcon
              size={16}
              className="mt-0.5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <span className="text-sm leading-relaxed">
              {t(`onboarding.location.${key}`)}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
        {t("onboarding.location.privacy")}
      </p>

      {/* The outcome is announced, not just coloured — a denied permission has
          to be understandable without seeing the button change. */}
      <div aria-live="polite" className="mt-5 w-full">
        {state === "granted" && (
          <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
            {t("onboarding.location.granted")}
          </p>
        )}
        {state === "denied" && (
          <p className="rounded-xl bg-muted px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            {t("onboarding.location.denied")}
          </p>
        )}
        {state === "unsupported" && (
          <p className="rounded-xl bg-muted px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            {t("onboarding.location.unsupported")}
          </p>
        )}
      </div>

      {resolved ? (
        <Button size="lg" className="mt-4 h-12 w-full" onClick={onNext}>
          {t("onboarding.next")}
        </Button>
      ) : (
        <>
          <Button
            size="lg"
            className="mt-4 h-12 w-full"
            onClick={onRequest}
            disabled={state === "requesting"}
          >
            {state === "requesting"
              ? t("onboarding.location.requesting")
              : t("onboarding.location.allow")}
          </Button>
          <button
            type="button"
            onClick={onNext}
            className="mt-3 h-11 px-4 text-sm text-muted-foreground hover:underline"
          >
            {t("onboarding.location.manual")}
          </button>
        </>
      )}
    </div>
  );
}

function DoneStep({
  onRun,
  onStart,
  t,
}: {
  onRun: (s: "toilet" | "route" | "ai") => void;
  onStart: () => void;
  t: Translate;
}) {
  const suggestions = [
    { id: "toilet" as const, icon: Toilet, key: "tryToilet" },
    { id: "route" as const, icon: Navigation, key: "tryRoute" },
    { id: "ai" as const, icon: Sparkles, key: "tryAi" },
  ];
  return (
    <div>
      <div className="mb-7 flex flex-col items-center text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <CheckIcon size={32} aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("onboarding.done.title")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("onboarding.done.subtitle")}
        </p>
      </div>

      <div className="space-y-2">
        {suggestions.map(({ id, icon: Icon, key }) => (
          <button
            key={id}
            type="button"
            onClick={() => onRun(id)}
            className="flex min-h-[56px] w-full items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/60"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <span className="text-sm font-medium">
              {t(`onboarding.done.${key}`)}
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onStart}
        className="mt-6 h-11 w-full text-sm text-muted-foreground hover:underline"
      >
        {t("onboarding.done.start")}
      </button>
    </div>
  );
}
