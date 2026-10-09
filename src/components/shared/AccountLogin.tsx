"use client";

import {
  CheckIcon,
  CompassIcon,
  GlobeIcon,
  InfoIcon,
  LoginIcon,
  LogoutIcon,
  MessageCircleIcon,
  PlusIcon,
  SettingsIcon,
  UserIcon,
  UserPlusIcon,
} from "@animateicons/react/lucide";
import {
  Brain,
  ClipboardList,
  Contrast,
  Database,
  KeyRound,
  Shield,
  SlidersHorizontal,
  Type,
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useAppTranslation } from "@/i18n/client";
import {
  type FontSizeEnum,
  fontSizeConfig,
  LanguageConfig,
  type LanguageEnum,
} from "@/lib/config";
import { QUICK_ACTION_DEFS } from "@/lib/quickActions";
import { cn } from "@/lib/utils";
import useAuthStore, { type SettingsTab } from "@/stores/useAuthStore";
import useMapStore from "@/stores/useMapStore";
import useOnboardingStore from "@/stores/useOnboardingStore";
import useQuickActionsStore from "@/stores/useQuickActionsStore";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../ui/select";
import { ThemeSwitcher } from "../ui/shadcn-io/theme-switcher";

const EmergencyContactsDialog = dynamic(
  () => import("@/components/Sos/EmergencyContactsDialog"),
  { ssr: false },
);
const EmergencyContactsManager = dynamic(
  () => import("@/components/Sos/EmergencyContactsManager"),
  { ssr: false },
);
const AccountSecurityPanel = dynamic(
  () => import("@/components/settings/AccountSecurityPanel"),
  { ssr: false },
);
const AIMemoryPanel = dynamic(
  () => import("@/components/settings/AIMemoryPanel"),
  { ssr: false },
);
const DataManagementPanel = dynamic(
  () => import("@/components/settings/DataManagementPanel"),
  { ssr: false },
);
const AuthDialog = dynamic(() => import("@/components/shared/AuthDialog"), {
  ssr: false,
});
const HelpDialog = dynamic(() => import("@/components/shared/HelpDialog"), {
  ssr: false,
});
const LineBindDialog = dynamic(
  () => import("@/components/shared/LineBindDialog"),
  { ssr: false },
);

export default function AccountLogin({ active = true }: { active?: boolean }) {
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [openDialog, setOpenDialog] = useState<
    null | "settings" | "feedback" | "help"
  >(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [contactsDialogOpen, setContactsDialogOpen] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [authDialogInitialMode, setAuthDialogInitialMode] = useState<
    "login" | "register" | "forgot"
  >("login");
  const [lineBindDialogOpen, setLineBindDialogOpen] = useState(false);
  const { t } = useAppTranslation("translation");
  const router = useRouter();
  const pathname = usePathname();

  // The reset-password page's "request a new link" button can't open the
  // login modal directly — it renders on its own bare layout, outside this
  // component's tree (see ClientLayout), so this component only ever mounts
  // fresh right as that navigation lands here. Reads location.search
  // directly (not useSearchParams) so this doesn't require a Suspense
  // boundary this component isn't wrapped in. One-shot deep-link handoff
  // read at the moment this component (re)mounts, not a live subscription
  // to route/pathname changes — hence the mount-only deps below.
  // `BottomSheet` mounts both a mobile and a desktop copy of this component
  // simultaneously (CSS-toggled, not conditionally rendered) — `active`
  // marks which one is actually visible, so only that copy reacts to a
  // cross-component signal like this deep link and opens its own Dialog.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!active) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("authModal") !== "forgot") return;
    setAuthDialogInitialMode("forgot");
    setAuthDialogOpen(true);
    params.delete("authModal");
    const nextSearch = params.toString();
    router.replace(nextSearch ? `${pathname}?${nextSearch}` : pathname, {
      scroll: false,
    });
  }, []);

  const {
    user,
    userConfig,
    updateUserConfig,
    logout,
    authDialogRequested,
    clearAuthDialogRequest,
    settingsDialogRequested,
    clearSettingsDialogRequest,
  } = useAuthStore(
    useShallow((s) => ({
      user: s.user,
      userConfig: s.userConfig,
      updateUserConfig: s.updateUserConfig,
      logout: s.logout,
      authDialogRequested: s.authDialogRequested,
      clearAuthDialogRequest: s.clearAuthDialogRequest,
      settingsDialogRequested: s.settingsDialogRequested,
      clearSettingsDialogRequest: s.clearSettingsDialogRequest,
    })),
  );

  // Any feature that needs an inline "please log in" prompt (e.g.
  // PlaceReviewSection's login CTA for anonymous visitors) sets this flag
  // instead of needing its own copy of AuthDialog's open state. Gated on
  // `active` for the same dual-mount reason as the deep-link effect above —
  // without it, both the mobile and desktop copy would open their own
  // AuthDialog off a single request, since only one of them clears the flag
  // fast enough to matter (zustand `set` is synchronous, but React batches
  // both components' effect runs off the same store update).
  useEffect(() => {
    if (!active || !authDialogRequested) return;
    setAuthDialogInitialMode("login");
    setAuthDialogOpen(true);
    clearAuthDialogRequest();
  }, [active, authDialogRequested, clearAuthDialogRequest]);

  // Same pattern for the Settings dialog — e.g. HomeContent's quick-actions
  // "編輯" button jumps straight to a specific tab instead of the user
  // having to find Settings in the account menu themselves.
  useEffect(() => {
    if (!active || !settingsDialogRequested) return;
    setSettingsTab(settingsDialogRequested);
    setOpenDialog("settings");
    clearSettingsDialogRequest();
  }, [active, settingsDialogRequested, clearSettingsDialogRequest]);
  const resetGuides = useOnboardingStore((s) => s.resetGuides);
  const { enabledActions, toggleAction } = useQuickActionsStore(
    useShallow((s) => ({
      enabledActions: s.enabledActions,
      toggleAction: s.toggleAction,
    })),
  );
  const { setActiveRailPanel, setSheetMode } = useMapStore(
    useShallow((s) => ({
      setActiveRailPanel: s.setActiveRailPanel,
      setSheetMode: s.setSheetMode,
    })),
  );
  const settingsSections = [
    {
      key: "general" as const,
      icon: SlidersHorizontal,
      label: t("settingsTabGeneral"),
      title: t("settingsAppearanceTitle"),
      desc: t("settingsAppearanceDesc"),
    },
    {
      key: "safety" as const,
      icon: Shield,
      label: t("settingsTabSafety"),
      title: t("settingsEmergencyTitle"),
      desc: t("settingsEmergencyDesc"),
    },
    {
      key: "account" as const,
      icon: KeyRound,
      label: "帳號安全",
      title: "帳號安全",
      desc: "管理登入密碼",
    },
    {
      key: "memory" as const,
      icon: Brain,
      label: t("settingsTabMemory"),
      title: t("aiMemoryTitle"),
      desc: t("aiMemoryDesc"),
    },
    {
      key: "data" as const,
      icon: Database,
      label: t("settingsTabData"),
      title: t("settingsDataTitle"),
      desc: t("settingsDataDesc"),
    },
  ];
  const activeSettingsSection =
    settingsSections.find((section) => section.key === settingsTab) ??
    settingsSections[0];
  const handleNotifyChange = async (checked: boolean) => {
    // Turning off never needs browser permission.
    if (!checked) {
      updateUserConfig({ notifications: false });
      return;
    }
    if (!("Notification" in window)) {
      updateUserConfig({ notifications: false });
      toast.error(t("notificationUnsupported"));
      return;
    }
    let permission = Notification.permission;
    if (permission === "default") {
      try {
        permission = await Notification.requestPermission();
      } catch {
        // Safari < 16 only supports the callback form.
        permission = await new Promise<NotificationPermission>((resolve) =>
          Notification.requestPermission(resolve),
        );
      }
    }
    if (permission === "granted") {
      updateUserConfig({ notifications: true });
    } else {
      updateUserConfig({ notifications: false });
      if (permission === "denied") toast.error(t("notificationBlocked"));
    }
  };

  const openSavedPlacesManager = () => {
    setOpenDialog(null);
    setSheetMode("home");
    setActiveRailPanel("saved");
  };

  // Settings sections that need an account currently just say "please log
  // in" with no way to act on it — the user has to close settings, find the
  // account menu, then come back. Closing settings and opening the auth
  // dialog directly skips that round trip.
  const goToLoginFromSettings = () => {
    setOpenDialog(null);
    setAuthDialogInitialMode("login");
    setAuthDialogOpen(true);
  };

  // Resetting the flags alone wouldn't show anything — the tour and its
  // gating (`ready`, deep-link checks) only run once at mount, in
  // `OnboardingHost`. A reload is the simplest way to re-enter that flow
  // exactly like a fresh first visit, without duplicating its gating logic
  // here.
  const rewatchTour = () => {
    resetGuides();
    window.location.reload();
  };

  const requiresLoginPrompt = (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/60 px-5 py-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        <LoginIcon size={20} />
      </span>
      <p className="text-sm text-muted-foreground">{t("login")}</p>
      <Button
        size="sm"
        className="rounded-full"
        onClick={goToLoginFromSettings}
      >
        {t("goToLoginRegister")}
      </Button>
    </div>
  );

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Account setting"
            size="icon-lg"
            className="text-muted-foreground hover:text-foreground focus:ring-2 bg-muted/60 hover:bg-muted border border-border/50 relative pointer-events-auto focus:ring-primary/30 rounded-full transition-colors duration-200"
          >
            {user?.avatar ? (
              <Image
                src={user.avatar}
                width={30}
                height={30}
                alt={user.name}
                className="w-full h-full rounded-full "
              />
            ) : (
              <UserIcon size={24} />
            )}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent className="w-56 bg-white dark:bg-gray-800 shadow-lg rounded-lg p-2">
          <DropdownMenuLabel className="text-sm font-semibold text-gray-700 dark:text-gray-200">
            {user ? t("welcome", { name: user.name }) : "請先登入"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {!user && (
            <>
              <DropdownMenuItem
                className="text-sm font-medium text-primary hover:bg-primary/10 focus:bg-primary/10 focus:text-primary rounded-md"
                onClick={() => {
                  setAuthDialogInitialMode("login");
                  setAuthDialogOpen(true);
                }}
              >
                <UserPlusIcon size={16} className="mr-2" />
                {t("loginRegisterCta")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuItem
            onClick={() => {
              const state = useMapStore.getState();
              if (state.isNavigating) {
                state.requestNavExit("my-reports");
                return;
              }
              state.setSheetMode("home");
              state.setActiveRailPanel("my-reports");
              state.setMobileSheetSnap("full");
            }}
          >
            <ClipboardList size={16} className="mr-2" />
            {t("myReportsTitle")}
          </DropdownMenuItem>

          {
            <>
              <DropdownMenuItem
                onClick={() => {
                  setSettingsTab("general");
                  setOpenDialog("settings");
                }}
                className="text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              >
                <SettingsIcon size={16} className="mr-2" />
                {t("settingTitle")}
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() => setOpenDialog("help")}
                className="text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              >
                <InfoIcon size={16} className="mr-2" />
                {t("help")}
              </DropdownMenuItem>

              <DropdownMenuItem
                onClick={() => setOpenDialog("feedback")}
                className="text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              >
                <MessageCircleIcon size={16} className="mr-2" />
                {t("feedback")}
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              {user && (
                <DropdownMenuItem
                  onClick={logout}
                  className="text-sm text-red-500 hover:text-red-600 rounded-md"
                >
                  <LogoutIcon size={16} className="mr-2" />
                  {t("logout")}
                </DropdownMenuItem>
              )}
            </>
          }
        </DropdownMenuContent>
      </DropdownMenu>

      {/* 使用說明 Dialog */}
      <HelpDialog
        open={openDialog === "help"}
        onOpenChange={() => setOpenDialog(null)}
      />

      <Dialog
        open={openDialog === "settings"}
        onOpenChange={() => setOpenDialog(null)}
      >
        <DialogContent className="w-[min(97vw,768px)] max-w-[min(97vw,768px)] h-[min(92vh,840px)] rounded-2xl p-0 overflow-hidden sm:max-w-[min(97vw,1280px)]">
          <div className="grid h-full grid-cols-1 grid-rows-[auto_minmax(0,1fr)] bg-background md:grid-cols-[30%_minmax(0,1fr)] md:grid-rows-none">
            <aside className="border-b md:border-b-0 md:border-r border-border/60 bg-muted/35 shrink-0">
              <div className="flex flex-row md:flex-col w-full">
                <div className="border-b border-border/60 px-3 py-4 md:px-4 md:py-5 hidden md:block">
                  <div className="space-y-1">
                    <p className="text-lg font-medium uppercase tracking-[0.18em] text-muted-foreground ">
                      {t("settingTitle")}
                    </p>
                  </div>
                </div>
                <nav className="flex flex-row md:flex-col w-full overflow-x-auto gap-1.5 px-4 py-3 md:px-3 md:py-4 md:space-y-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden shrink-0">
                  {settingsSections.map((section) => {
                    const Icon = section.icon;
                    const active = settingsTab === section.key;
                    return (
                      <button
                        key={section.key}
                        type="button"
                        onClick={() => setSettingsTab(section.key)}
                        className={`flex w-auto md:w-full items-center justify-start gap-2.5 rounded-xl px-3.5 py-2.5 md:px-3 md:py-3 text-left text-sm transition-colors shrink-0 ${
                          active
                            ? "bg-background text-foreground shadow-sm ring-1 ring-border/70"
                            : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                        }`}
                        aria-pressed={active}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="font-medium truncate">
                          {section.label}
                        </span>
                      </button>
                    );
                  })}
                </nav>
              </div>
            </aside>

            <div className="flex min-w-0 min-h-0 flex-col">
              <div className="shrink-0 border-b border-border/60 px-5 py-5 md:px-7">
                <DialogHeader className="space-y-1">
                  <DialogTitle className="text-xl font-semibold">
                    {activeSettingsSection.title}
                  </DialogTitle>
                </DialogHeader>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 md:px-7">
                <div className="space-y-4">
                  {settingsTab === "general" && (
                    <div className="rounded-2xl border border-border/60 bg-background p-4 space-y-4">
                      <div className="flex justify-between items-center gap-4">
                        <span className="text-sm font-medium text-foreground">
                          {t("darkMode")}
                        </span>
                        <ThemeSwitcher
                          value={userConfig.darkMode}
                          onChange={(changeTheme) => {
                            updateUserConfig({ darkMode: changeTheme });
                          }}
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between items-center gap-4">
                          <span className="text-sm font-medium text-foreground flex items-center gap-1">
                            <Contrast className="h-4 w-4" /> {t("highContrast")}
                          </span>
                          <Switch
                            id="highContrast"
                            className="bg-accent"
                            checked={userConfig.highContrast}
                            onCheckedChange={(checked) =>
                              updateUserConfig({ highContrast: checked })
                            }
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {t("settingsHighContrastLocalHint")}
                        </p>
                      </div>

                      <div className="flex justify-between items-center gap-4">
                        <span className="text-sm font-medium text-foreground">
                          {t("notification")}
                        </span>
                        <Switch
                          id="notification"
                          className=" bg-accent"
                          checked={userConfig.notifications}
                          onCheckedChange={handleNotifyChange}
                        />
                      </div>

                      <div className="flex justify-between gap-4">
                        <span className="text-sm font-medium text-foreground flex items-center gap-1">
                          <GlobeIcon size={16} /> {t("language")}
                        </span>
                        <Select
                          value={userConfig.language}
                          onValueChange={(key) =>
                            updateUserConfig({
                              language: key as LanguageEnum,
                            })
                          }
                        >
                          <SelectTrigger>
                            {LanguageConfig[userConfig.language].label}
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(LanguageConfig).map(
                              ([key, config]) => (
                                <SelectItem key={key} value={key}>
                                  {config.label}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex justify-between gap-4">
                        <span className="text-sm font-medium text-foreground flex items-center gap-1">
                          <Type className="h-4 w-4" /> {t("fontSize")}
                        </span>
                        <Select
                          onValueChange={(v) =>
                            updateUserConfig({
                              fontSize: v as FontSizeEnum,
                            })
                          }
                          value={userConfig.fontSize}
                        >
                          <SelectTrigger className="text-sm">
                            {fontSizeConfig[userConfig.fontSize].label}
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(fontSizeConfig).map(
                              ([key, config]) => (
                                <SelectItem key={key} value={key}>
                                  {config.label}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  {settingsTab === "general" && (
                    <div className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-background p-4">
                      <div className="flex items-center gap-2">
                        <CompassIcon
                          size={16}
                          className="text-muted-foreground"
                        />
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {t("resetGuides")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {t("resetGuidesDesc")}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full shrink-0"
                        onClick={rewatchTour}
                      >
                        {t("resetGuidesButton")}
                      </Button>
                    </div>
                  )}

                  {settingsTab === "general" && (
                    <div className="mt-4 rounded-2xl border border-border/60 bg-background p-4 space-y-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {t("homeShortcutsSettingsTitle")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t("homeShortcutsSettingsDesc")}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {QUICK_ACTION_DEFS.map((def) => {
                          const enabled = enabledActions.includes(def.id);
                          return (
                            <button
                              key={def.id}
                              type="button"
                              onClick={() => toggleAction(def.id)}
                              aria-pressed={enabled}
                              className={cn(
                                "flex min-h-11 items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-all",
                                enabled
                                  ? "bg-primary/10 text-primary ring-2 ring-primary/40"
                                  : "bg-muted/40 text-muted-foreground/70 hover:bg-muted",
                              )}
                            >
                              {enabled ? (
                                <CheckIcon size={16} />
                              ) : (
                                <PlusIcon size={16} />
                              )}
                              <def.Icon
                                className={cn("h-4 w-4", def.iconClassName)}
                              />
                              {t(def.labelKey)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {settingsTab === "safety" && user && (
                    <div className="rounded-2xl border border-border/60 bg-background p-5 space-y-4">
                      <EmergencyContactsManager />
                    </div>
                  )}
                  {settingsTab === "safety" && !user && requiresLoginPrompt}
                  {settingsTab === "account" && user && (
                    <div className="rounded-2xl border border-border/60 bg-background p-5 space-y-4">
                      <AccountSecurityPanel user={user} />
                    </div>
                  )}
                  {settingsTab === "account" && !user && requiresLoginPrompt}
                  {settingsTab === "memory" && (
                    <AIMemoryPanel
                      active={
                        openDialog === "settings" && settingsTab === "memory"
                      }
                      loggedIn={Boolean(user)}
                    />
                  )}
                  {settingsTab === "data" && (
                    <DataManagementPanel
                      onOpenSavedPlaces={openSavedPlacesManager}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <EmergencyContactsDialog
        open={contactsDialogOpen}
        onOpenChange={setContactsDialogOpen}
      />

      <AuthDialog
        open={authDialogOpen}
        onOpenChange={setAuthDialogOpen}
        initialMode={authDialogInitialMode}
        onLoggedIn={(loggedInUser) => {
          if (!loggedInUser.lineUserId) setLineBindDialogOpen(true);
        }}
      />

      <LineBindDialog
        open={lineBindDialogOpen}
        onOpenChange={setLineBindDialogOpen}
      />

      {/* 問題回饋 Dialog */}

      <Dialog
        open={openDialog === "feedback"}
        onOpenChange={() => setOpenDialog(null)}
      >
        <DialogContent className="max-w-md rounded-lg p-6">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">
              {t("feedback")}
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500">
              {t("feedbackDesc")}
            </DialogDescription>
          </DialogHeader>

          <textarea
            className="w-full border rounded-md p-2 text-sm mt-4"
            rows={4}
            placeholder={t("feedbackPlaceholder")}
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
          />
          <Button aria-label="Submit feedback" className="w-full mt-2 text-sm">
            {t("submit")}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
