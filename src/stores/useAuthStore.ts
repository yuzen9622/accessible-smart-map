import { create } from "zustand";
import { updateConfig } from "@/lib/api/user";
import { configureAuthState } from "@/lib/authRefresh";
import { revokeSession } from "@/lib/authTransport";
import { ColorEnum, FontSizeEnum, LanguageEnum } from "@/lib/config";
import useChatStore from "@/stores/useChatStore";
import type { UserConfig, UserDTO } from "@/types/user";

const HIGH_CONTRAST_STORAGE_KEY = "userConfig.highContrast";
const REMOTE_CONFIG_KEYS = [
  "language",
  "darkMode",
  "themeColor",
  "fontSize",
  "notifications",
  "memoryEnabled",
] as const;

function readStoredHighContrast() {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(HIGH_CONTRAST_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeStoredHighContrast(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(HIGH_CONTRAST_STORAGE_KEY, String(value));
  } catch {
    // ignore localStorage failures
  }
}

function readStoredDarkMode(): "light" | "dark" | "system" {
  if (typeof window === "undefined") return "system";
  try {
    const val = localStorage.getItem("theme");
    if (val === "light" || val === "dark" || val === "system") {
      return val;
    }
    return "system";
  } catch {
    return "system";
  }
}

export type SettingsTab = "general" | "safety" | "account" | "memory" | "data";

interface AuthState {
  user: UserDTO | null;
  userConfig: UserConfig;
  session: { accessToken: string } | null;
  /** Set by any component that needs an inline "please log in" prompt to
   * open the login modal directly — e.g. PlaceReviewSection's "登入/註冊"
   * button. `AccountLogin` (the only place that actually owns AuthDialog's
   * open state) watches this and opens the dialog when it flips true, then
   * clears it back. Avoids threading dialog-open state through every
   * feature that might need to prompt a login. */
  authDialogRequested: boolean;
  /** Same "please open a dialog you don't own" pattern as
   * `authDialogRequested`, for the Settings dialog: e.g. HomeContent's
   * quick-actions "編輯" button jumps straight to Settings → 一般 instead of
   * making the user find it in the account menu themselves. Non-null tab
   * also picks which Settings section opens on. */
  settingsDialogRequested: SettingsTab | null;
}

interface AuthAction {
  setUser: (user: UserDTO | null) => void;
  setUserConfig: (config: UserConfig) => void;
  setSession: (session: { accessToken: string }) => void;
  updateUserConfig: (config: Partial<UserConfig>) => void;
  logout: () => void;
  requestAuthDialog: () => void;
  clearAuthDialogRequest: () => void;
  requestSettingsDialog: (tab?: SettingsTab) => void;
  clearSettingsDialogRequest: () => void;
}

type AuthStore = AuthState & AuthAction;
const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  userConfig: {
    themeColor: ColorEnum.Default,
    darkMode: readStoredDarkMode(),
    fontSize: FontSizeEnum.Medium,
    notifications: false,
    highContrast: readStoredHighContrast(),
    language: LanguageEnum.Chinese,
    memoryEnabled: true,
  },
  session: null,
  authDialogRequested: false,
  requestAuthDialog: () => set({ authDialogRequested: true }),
  clearAuthDialogRequest: () => set({ authDialogRequested: false }),
  settingsDialogRequested: null,
  requestSettingsDialog: (tab = "general") =>
    set({ settingsDialogRequested: tab }),
  clearSettingsDialogRequest: () => set({ settingsDialogRequested: null }),
  setSession: (session) =>
    set((state) => ({ session: { ...state.session, ...session } })),
  setUser: (user) => set({ user }),
  setUserConfig: (config) => {
    set((state) => ({
      userConfig: {
        ...state.userConfig,
        ...config,
        highContrast: readStoredHighContrast(),
      },
    }));
  },
  updateUserConfig: (config) => {
    const user = get().user;
    if (typeof config.highContrast === "boolean") {
      writeStoredHighContrast(config.highContrast);
    }

    const remoteConfig = Object.fromEntries(
      REMOTE_CONFIG_KEYS.flatMap((key) =>
        key in config ? [[key, config[key]]] : [],
      ),
    );

    if (user && Object.keys(remoteConfig).length > 0) {
      // Must NOT send user_id: the backend derives identity from the
      // Authorization token and its UpdateConfigBodySchema is .strict() —
      // any unknown key (incl. user_id) is rejected with 400.
      updateConfig(remoteConfig).catch((error) => {
        console.error("[useAuthStore] updateConfig failed", error);
      });
    }
    set((state) => ({ userConfig: { ...state.userConfig, ...config } }));
  },
  logout: () => {
    // Synchronous logout: capture whether an active session exists first,
    // clear local state synchronously (so `session` becomes an immediately
    // observable logout intent), then fire the revoke request via pure cookie —
    // never through fetchRequest, so it can never enter the 401-refresh path.
    const hasSession = Boolean(get().session || get().user);
    set({ user: null, session: null });
    // The AI chat panel's conversation now survives collapse/reopen and a
    // page reload (it lives in a store + sessionStorage, not component
    // state) — without this it would also survive a logout, leaving one
    // user's chat history (addresses, a11y needs, …) visible to the next
    // person on a shared device. `clearAll()` also drops the sessionStorage
    // snapshot, not just the in-memory state.
    useChatStore.getState().clearAll();
    if (hasSession) {
      revokeSession().catch((error) => {
        console.error("[useAuthStore] revokeSession failed", error);
      });
    }
  },
}));

// Register this store as the auth-state port for the shared single-flight
// refresh coordinator (plan §4 authRefresh.ts row) right after creation.
configureAuthState({
  getSession: () => useAuthStore.getState().session,
  setSession: (session) => useAuthStore.getState().setSession(session),
  setUser: (user) => useAuthStore.getState().setUser(user),
});

export default useAuthStore;
