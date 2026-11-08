"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useId, useState } from "react";
import { toast } from "sonner";
import StatusPage from "@/components/shared/StatusPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppTranslation } from "@/i18n/client";
import { resetPassword } from "@/lib/api/auth";
import { ApiError } from "@/lib/fetch";
import { validatePassword } from "@/lib/passwordValidation";
import useAuthStore from "@/stores/useAuthStore";

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}

function ResetPasswordContent() {
  const { t } = useAppTranslation();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const lng = pathname.split("/")[1] || "zh-TW";
  const token = searchParams.get("token");
  const newPasswordId = useId();
  const confirmPasswordId = useId();

  const setUser = useAuthStore((s) => s.setUser);
  const setUserConfig = useAuthStore((s) => s.setUserConfig);
  const setSession = useAuthStore((s) => s.setSession);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 401 INVALID_TOKEN is unrecoverable from this form (the token is spent
  // either way) — swap to the same full-page "request a new link" shell the
  // missing-token case below uses, instead of leaving a dead form on screen.
  const [tokenInvalid, setTokenInvalid] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || !token) return;
    setError(null);

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("auth.passwordMismatch"));
      return;
    }

    setLoading(true);
    try {
      const res = await resetPassword(token, newPassword);
      if (!res.ok) {
        // fetchRequest never throws on a plain 401 for an unauthenticated
        // call (see lib/fetch.ts) — it resolves here as `ok: false` instead.
        // Any other non-2xx status (e.g. 400 field validation) throws below,
        // so reaching this branch means INVALID_TOKEN.
        setTokenInvalid(true);
        return;
      }
      if (res.data?.user) setUser(res.data.user);
      if (res.data?.config) setUserConfig(res.data.config);
      if (res.accessToken) setSession({ accessToken: res.accessToken });
      toast.success(t("auth.resetSuccessToast"));
      // Same destination a successful login lands on — never the login page.
      router.replace(`/${lng}/map/`);
    } catch (err) {
      if (err instanceof ApiError) {
        // 400 field-validation errors: { data: { errors: [{ path, message }] } }.
        const fieldErrors = (
          err.data as { errors?: { path?: string; message: string }[] }
        )?.errors;
        setError(fieldErrors?.[0]?.message || err.message);
      } else {
        // fetch() itself rejected (offline, DNS, timeout, aborted, …) — this
        // is neither a success nor a 401 and must not be presented as either.
        setError(t("auth.resetNetworkError"));
      }
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <StatusPage
        status="error"
        title={t("auth.resetPasswordMissingTokenTitle")}
        description={t("auth.resetPasswordMissingTokenDesc")}
        primaryAction={{
          label: t("auth.reapplyReset"),
          // The "forgot password" flow lives inside the login modal, not a
          // standalone route (see AccountLogin.tsx) — this hands off to the
          // home page with a one-shot deep-link flag it picks up on mount.
          href: `/${lng}/map/?authModal=forgot`,
        }}
      />
    );
  }

  if (tokenInvalid) {
    return (
      <StatusPage
        status="error"
        title={t("auth.resetPasswordExpiredTitle")}
        description={t("auth.resetPasswordExpiredDesc")}
        primaryAction={{
          label: t("auth.reapplyReset"),
          // The "forgot password" flow lives inside the login modal, not a
          // standalone route (see AccountLogin.tsx) — this hands off to the
          // home page with a one-shot deep-link flag it picks up on mount.
          href: `/${lng}/map/?authModal=forgot`,
        }}
      >
        {/* Fields stay visible (not swapped away) so it's clear this is
            still the reset form, just spent — real `disabled` (not
            aria-disabled) since there's no pending request to preserve
            focus through here, and it lets a screen reader announce them
            as unavailable rather than silently vanishing. */}
        <div className="space-y-3 text-left">
          <div className="space-y-1.5">
            <label
              htmlFor={newPasswordId}
              className="text-sm font-medium text-muted-foreground"
            >
              {t("auth.newPassword")}
            </label>
            <Input
              id={newPasswordId}
              type="password"
              autoComplete="new-password"
              value={newPassword}
              disabled
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor={confirmPasswordId}
              className="text-sm font-medium text-muted-foreground"
            >
              {t("auth.confirmPassword")}
            </label>
            <Input
              id={confirmPasswordId}
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              disabled
            />
          </div>
          <Button type="button" className="w-full" disabled>
            {t("auth.resetSubmit")}
          </Button>
        </div>
      </StatusPage>
    );
  }

  // The active form step isn't a "result" the shared shell models — it stays
  // a bespoke form, still inside the same StatusPage card for visual
  // consistency with the result states above. No status icon applies to an
  // in-progress form, so it's hidden rather than showing a misleading
  // spinner or checkmark.
  return (
    <StatusPage status="pending" hideIcon title={t("auth.resetPassword")}>
      <form onSubmit={handleSubmit} className="space-y-3 text-left" noValidate>
        <div className="space-y-1.5">
          <label
            htmlFor={newPasswordId}
            className="text-sm font-medium text-foreground"
          >
            {t("auth.newPassword")}
          </label>
          <Input
            id={newPasswordId}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            aria-invalid={!!error}
            required
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor={confirmPasswordId}
            className="text-sm font-medium text-foreground"
          >
            {t("auth.confirmPassword")}
          </label>
          <Input
            id={confirmPasswordId}
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            aria-invalid={!!error}
            required
          />
        </div>

        {/* Always mounted (not conditionally rendered) so assistive tech
            already has this live region registered before an error lands —
            an aria-live region inserted at the same moment as its content
            is unreliable in several screen readers. Paired with the
            `aria-invalid` above rather than relying on the destructive-red
            border alone. */}
        <p aria-live="assertive" className="min-h-4 text-sm text-destructive">
          {error}
        </p>

        <Button
          type="submit"
          aria-disabled={loading}
          className={`w-full ${loading ? "opacity-50 pointer-events-none" : ""}`}
        >
          {loading ? t("auth.resetSubmitting") : t("auth.resetSubmit")}
        </Button>
      </form>
    </StatusPage>
  );
}
