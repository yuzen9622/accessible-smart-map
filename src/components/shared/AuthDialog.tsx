"use client";

import {
  CheckIcon,
  type CheckIconHandle,
  EyeIcon,
  EyeOffIcon,
} from "@animateicons/react/lucide";
import { GoogleLogin } from "@react-oauth/google";
import { AlertCircle, MailCheck } from "lucide-react";
import Image from "next/image";
import { useTheme } from "next-themes";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppTranslation } from "@/i18n/client";
import {
  forgotPassword,
  loginWithEmail,
  loginWithGoogle,
  registerWithEmail,
  resendVerificationEmail,
} from "@/lib/api/auth";
import { ApiError } from "@/lib/fetch";
import { validatePassword } from "@/lib/passwordValidation";
import { cn } from "@/lib/utils";
import useAuthStore from "@/stores/useAuthStore";
import type { UserConfig, UserDTO } from "@/types/user";

type Mode = "login" | "register" | "forgot";

// Common webmail inboxes by domain, so the post-registration "open inbox" CTA
// lands somewhere real instead of a mailto: link that often opens nothing on
// a machine with no configured mail client.
const WEBMAIL_BY_DOMAIN: Record<string, string> = {
  "gmail.com": "https://mail.google.com",
  "googlemail.com": "https://mail.google.com",
  "outlook.com": "https://outlook.live.com/mail/",
  "hotmail.com": "https://outlook.live.com/mail/",
  "live.com": "https://outlook.live.com/mail/",
  "yahoo.com": "https://mail.yahoo.com",
  "yahoo.com.tw": "https://tw.mail.yahoo.com",
  "icloud.com": "https://www.icloud.com/mail",
};

function webmailUrlFor(email: string): string | null {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  return domain ? (WEBMAIL_BY_DOMAIN[domain] ?? null) : null;
}

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after a successful interactive login (Google or email/password). */
  onLoggedIn?: (user: UserDTO) => void;
  /** Which step to land on when the dialog next opens — e.g. deep-linking
   * straight to "forgot password" from the reset-password page's "request a
   * new link" button, instead of always starting at the login tab. */
  initialMode?: Mode;
}

export default function AuthDialog({
  open,
  onOpenChange,
  onLoggedIn,
  initialMode,
}: AuthDialogProps) {
  const { t } = useAppTranslation("translation");
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const [mode, setMode] = useState<Mode>("login");
  const nicknameId = useId();
  const emailId = useId();
  const passwordId = useId();
  const forgotEmailId = useId();
  const errorId = useId();
  const passwordHintId = useId();

  // Only apply on the transition into `open` (not every render) so a user
  // manually switching tabs inside an already-open dialog isn't yanked back
  // to `initialMode` by an unrelated re-render.
  useEffect(() => {
    if (open && initialMode) setMode(initialMode);
  }, [open, initialMode]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState(false);
  const [registered, setRegistered] = useState<null | { emailSent: boolean }>(
    null,
  );
  const [forgotSent, setForgotSent] = useState(false);
  const successCheckRef = useRef<CheckIconHandle>(null);

  const googleBtnRef = useRef<HTMLDivElement>(null);
  const [googleBtnWidth, setGoogleBtnWidth] = useState(320);

  // Registration success is the one moment in this dialog worth celebrating —
  // play the checkmark once as it appears, not just on hover, matching the
  // "reward moment" the S2 redesign asked for.
  useEffect(() => {
    if (registered) successCheckRef.current?.startAnimation();
  }, [registered]);

  useEffect(() => {
    const el = googleBtnRef.current;
    if (!el || !open) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setGoogleBtnWidth(Math.round(width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [open]);

  const { setUser, setSession, setUserConfig } = useAuthStore(
    useShallow((s) => ({
      setUser: s.setUser,
      setSession: s.setSession,
      setUserConfig: s.setUserConfig,
    })),
  );

  const reset = () => {
    setMode("login");
    setName("");
    setEmail("");
    setPassword("");
    setShowPassword(false);
    setError(null);
    setNeedsVerification(false);
    setRegistered(null);
    setForgotSent(false);
    setLoading(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const applySession = (data: {
    user?: UserDTO;
    config?: UserConfig;
    accessToken?: string;
  }) => {
    if (data.user) setUser(data.user);
    if (data.config) setUserConfig(data.config);
    if (data.accessToken) setSession({ accessToken: data.accessToken });
  };

  const handleGoogleSuccess = async (credential: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await loginWithGoogle(credential);
      if (!res.ok) {
        setError(res.message || t("auth.googleLoginFailed"));
        return;
      }
      applySession({
        user: res.data?.user,
        config: res.data?.config,
        accessToken: res.accessToken,
      });
      handleOpenChange(false);
      if (res.data?.user) onLoggedIn?.(res.data.user);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("auth.googleLoginFailed"),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      await resendVerificationEmail(email);
      toast.success(t("auth.resendSuccess"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("auth.resendFailed"));
    }
  };

  const handleLogin = async () => {
    setError(null);
    setNeedsVerification(false);
    setLoading(true);
    try {
      const res = await loginWithEmail(email, password);
      if (!res.ok) {
        // The only case fetchRequest returns without throwing is a 401.
        setError(t("auth.loginErrorCreds"));
        return;
      }
      applySession({
        user: res.data?.user,
        config: res.data?.config,
        accessToken: res.accessToken,
      });
      handleOpenChange(false);
      if (res.data?.user) onLoggedIn?.(res.data.user);
    } catch (err) {
      if (err instanceof ApiError && err.code === 403) {
        setNeedsVerification(true);
        setError(t("auth.needsVerification"));
      } else if (err instanceof ApiError && err.code === 429) {
        toast.error(t("auth.loginTooMany"));
      } else {
        toast.error(err instanceof Error ? err.message : t("auth.loginFailed"));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setError(null);
    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    setLoading(true);
    try {
      const res = await registerWithEmail(name, email, password);
      if (res.ok) {
        setRegistered({ emailSent: res.data?.emailSent ?? true });
      } else {
        setError(res.message || t("auth.registerFailed"));
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 409) {
        setError(t("auth.emailTaken"));
      } else {
        setError(err instanceof Error ? err.message : t("auth.registerFailed"));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async () => {
    setError(null);
    setLoading(true);
    try {
      await forgotPassword(email);
      setForgotSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === 503) {
        setError(t("auth.forgotSendFailed"));
      } else {
        setForgotSent(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const showTabs = mode !== "forgot" && !registered;
  const showGoogle = mode !== "forgot" && !registered;

  // Live, non-blocking strength hint while registering — the old behaviour
  // only surfaced `validatePassword`'s message after a failed submit, so a
  // simple mistake wasn't visible until the user had already hit "register".
  const passwordHint =
    mode === "register" && password.length > 0
      ? validatePassword(password)
      : null;

  const webmailUrl = useMemo(() => webmailUrlFor(email), [email]);

  const guestPathLink = (
    <button
      type="button"
      onClick={() => handleOpenChange(false)}
      className="text-left text-sm font-medium text-muted-foreground hover:text-foreground hover:underline"
    >
      {t("auth.guestPath")}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton
        className="grid w-[min(94vw,880px)] max-w-[min(94vw,880px)] sm:max-w-[min(94vw,880px)] grid-cols-1 gap-0 overflow-hidden rounded-3xl p-0 lg:grid-cols-2"
      >
        {/* Left: brand + concrete value props, desktop only. Replaces the old
            one-line "享有完整功能" with three things the user actually cares
            about, per the S2 redesign. */}
        <div className="hidden flex-col justify-between border-r border-border/60 bg-muted/40 p-8 lg:flex">
          <div>
            <div className="mb-8 flex items-center gap-2.5">
              <Image
                src="/logo.webp"
                alt=""
                width={36}
                height={36}
                className="rounded-xl"
              />
              <span className="font-semibold">{t("title")}</span>
            </div>
            <div className="space-y-5">
              {[
                {
                  title: t("auth.valueSyncTitle"),
                  desc: t("auth.valueSyncDesc"),
                },
                {
                  title: t("auth.valueSosTitle"),
                  desc: t("auth.valueSosDesc"),
                },
                { title: t("auth.valueAiTitle"), desc: t("auth.valueAiDesc") },
              ].map((item) => (
                <div key={item.title} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <CheckIcon size={14} />
                  </span>
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {guestPathLink}
        </div>

        {/* Mobile: value props collapse into three short lines above the form. */}
        <div className="space-y-1.5 border-b border-border/60 px-6 pt-6 pb-4 lg:hidden">
          {[
            t("auth.valueSyncTitle"),
            t("auth.valueSosTitle"),
            t("auth.valueAiTitle"),
          ].map((line) => (
            <div
              key={line}
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <CheckIcon size={14} className="shrink-0 text-primary" />
              {line}
            </div>
          ))}
        </div>

        {/* Right: the actual form. */}
        <div className="flex flex-col gap-4 p-6 sm:p-8">
          <DialogTitle className="text-xl font-semibold">
            {mode === "login" && t("auth.welcomeBack")}
            {mode === "register" && t("auth.createAccount")}
            {mode === "forgot" && t("auth.resetPassword")}
          </DialogTitle>

          {showTabs && (
            <Tabs
              value={mode}
              onValueChange={(v) => {
                setError(null);
                setMode(v as Mode);
              }}
            >
              <TabsList className="w-full">
                <TabsTrigger value="login">{t("auth.login")}</TabsTrigger>
                <TabsTrigger value="register">{t("auth.register")}</TabsTrigger>
              </TabsList>
            </Tabs>
          )}

          {showGoogle && (
            <div
              ref={googleBtnRef}
              className="gsi-host flex w-full justify-center"
            >
              <GoogleLogin
                key={isDark ? "dark" : "light"}
                onSuccess={(credentialResponse) => {
                  if (credentialResponse.credential) {
                    void handleGoogleSuccess(credentialResponse.credential);
                  }
                }}
                onError={() => toast.error(t("auth.googleLoginFailed"))}
                theme={isDark ? "filled_black" : "outline"}
                size="large"
                text="continue_with"
                shape="pill"
                width={googleBtnWidth}
              />
            </div>
          )}

          {showGoogle && (
            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">
                {t("auth.orEmail")}
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
          )}

          {mode === "register" && registered ? (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <CheckIcon ref={successCheckRef} size={28} isAnimated={false} />
              </span>
              <p className="text-base font-semibold">
                {t("auth.registerSuccessTitle")}
              </p>
              {registered.emailSent ? (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MailCheck className="h-4 w-4 shrink-0" />
                  {t("auth.registerSuccessBody", { email })}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("auth.registerNoEmailBody")}
                </p>
              )}
              <div className="mt-2 w-full space-y-2">
                {registered.emailSent && webmailUrl ? (
                  <Button asChild size="lg" className="w-full">
                    <a
                      href={webmailUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t("auth.openInbox")}
                    </a>
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant={
                    registered.emailSent && webmailUrl ? "outline" : "default"
                  }
                  size="lg"
                  className="w-full"
                  onClick={handleResend}
                >
                  {t("auth.resend")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  className="w-full"
                  onClick={() => {
                    setRegistered(null);
                    setMode("login");
                    setPassword("");
                  }}
                >
                  {t("auth.goToLogin")}
                </Button>
              </div>
            </div>
          ) : mode === "forgot" ? (
            forgotSent ? (
              <div className="space-y-3 text-sm">
                <p>{t("auth.forgotSentBody")}</p>
                <Button
                  type="button"
                  size="lg"
                  className="w-full"
                  onClick={() => setMode("login")}
                >
                  {t("auth.backToLogin")}
                </Button>
              </div>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleForgot();
                }}
              >
                <div className="space-y-1.5">
                  <label htmlFor={forgotEmailId} className="sr-only">
                    {t("auth.email")}
                  </label>
                  <Input
                    id={forgotEmailId}
                    type="email"
                    autoComplete="email"
                    placeholder={t("auth.email")}
                    className="h-11"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={!!error}
                    aria-describedby={error ? errorId : undefined}
                    required
                  />
                </div>
                {error && (
                  <p
                    id={errorId}
                    role="alert"
                    className="flex items-center gap-1.5 text-sm text-destructive"
                  >
                    <AlertCircle
                      aria-hidden="true"
                      className="size-4 shrink-0"
                    />
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={loading}
                >
                  {t("auth.forgotSendButton")}
                </Button>
                <button
                  type="button"
                  className="w-full text-center text-xs text-muted-foreground hover:underline"
                  onClick={() => setMode("login")}
                >
                  {t("auth.backToLogin")}
                </button>
              </form>
            )
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void (mode === "login" ? handleLogin() : handleRegister());
              }}
            >
              {mode === "register" && (
                <div className="space-y-1.5">
                  <label htmlFor={nicknameId} className="sr-only">
                    {t("auth.nickname")}
                  </label>
                  <Input
                    id={nicknameId}
                    autoComplete="nickname"
                    placeholder={t("auth.nickname")}
                    className="h-11"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <label htmlFor={emailId} className="sr-only">
                  {t("auth.email")}
                </label>
                <Input
                  id={emailId}
                  type="email"
                  autoComplete="email"
                  placeholder={t("auth.email")}
                  className="h-11"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={!!error}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <div className="relative">
                  <label htmlFor={passwordId} className="sr-only">
                    {t("auth.password")}
                  </label>
                  <Input
                    id={passwordId}
                    type={showPassword ? "text" : "password"}
                    autoComplete={
                      mode === "register" ? "new-password" : "current-password"
                    }
                    placeholder={t("auth.password")}
                    className="h-11 pr-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    aria-invalid={!!error}
                    aria-describedby={
                      error
                        ? errorId
                        : mode === "register" && passwordHint
                          ? passwordHintId
                          : undefined
                    }
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-pressed={showPassword}
                    aria-label={
                      showPassword
                        ? t("auth.hidePassword")
                        : t("auth.showPassword")
                    }
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOffIcon size={16} />
                    ) : (
                      <EyeIcon size={16} />
                    )}
                  </button>
                </div>
                {mode === "register" && passwordHint && (
                  <p
                    id={passwordHintId}
                    aria-live="polite"
                    className="text-xs text-muted-foreground"
                  >
                    {passwordHint}
                  </p>
                )}
                {mode === "login" && (
                  <button
                    type="button"
                    className="block text-xs text-muted-foreground hover:underline"
                    onClick={() => {
                      setError(null);
                      setMode("forgot");
                    }}
                  >
                    {t("auth.forgotPassword")}
                  </button>
                )}
              </div>
              {error && (
                <div className="space-y-1.5">
                  <p
                    id={errorId}
                    role="alert"
                    className="flex items-center gap-1.5 text-sm text-destructive"
                  >
                    <AlertCircle
                      aria-hidden="true"
                      className="size-4 shrink-0"
                    />
                    {error}
                  </p>
                  {needsVerification && (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={handleResend}
                    >
                      {t("auth.resendVerification")}
                    </button>
                  )}
                </div>
              )}
              <Button
                type="submit"
                size="lg"
                className="w-full"
                disabled={loading}
              >
                {mode === "login" ? t("auth.login") : t("auth.register")}
              </Button>
            </form>
          )}

          <div className={cn("lg:hidden", showTabs ? "pt-1" : "")}>
            {guestPathLink}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
