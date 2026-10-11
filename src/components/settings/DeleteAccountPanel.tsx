"use client";

import { GoogleLogin } from "@react-oauth/google";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppTranslation } from "@/i18n/client";
import {
  createAccountDeletion,
  type DeletionState,
} from "@/lib/accountDeletion";
import type { UserDTO } from "@/types/user";

const copy = {
  title: "永久刪除帳號",
  details:
    "帳號、個人設定與無障礙檔案、緊急聯絡人、SOS 紀錄、AI 記憶及評論將永久刪除。危險通報會匿名化並保留。此操作無法復原，所有裝置將登出。",
  continue: "我了解，繼續",
  confirm: "確認永久刪除",
  consent: "我確認要永久刪除目前這個帳號，且了解無法復原。",
  cancel: "取消",
  busy: "處理中…",
  inFlight: "取消會停止後續步驟，但無法撤回已送出的刪除請求。",
  password: "目前密碼",
  passwordSubmit: "重新登入並刪除",
  google: "請使用同一個 Google 帳號重新登入；成功後會立即重試刪除一次。",
  apple:
    "此帳號綁定 Apple。請到行動 App 重新取得 Apple 授權以完成刪除；網頁不支援此授權。",
  appleUnavailable:
    "Apple 暫時無法撤銷授權，尚未刪除資料。請稍後使用行動 App 重試。",
  reauth:
    "請完整重新登入目前帳號以確認身分（需為 5 分鐘內登入）。更新權杖不算重新登入；成功後會立即重試刪除一次。",
  reauthFailed:
    "重新登入未完成或已逾時。請確認登入資料後再試；尚未確認刪除成功。",
  wrongAccount:
    "重新登入的帳號不符或登入回應不完整。未變更目前登入，也未重試刪除；請使用正確帳號重新驗證。",
  sessionChanged: "登入狀態已變更，已停止此刪除流程。請重新開啟帳號設定。",
  expired: "登入已失效，已清除本機登入。請重新登入後再試。",
  partial:
    "伺服器未完成刪除，可能已刪除部分資料並撤銷所有登入。無法保證資料復原；請重新登入後重試。",
  failed: "無法確認刪除成功。請稍後重試。",
  deleted: "帳號已刪除，本機登入與對話已清除。",
} as const;

export default function DeleteAccountPanel({ user }: { user: UserDTO }) {
  const { t } = useAppTranslation("translation");
  const text = (key: keyof typeof copy) =>
    t(`accountDeletion.${key}`, { defaultValue: copy[key] });
  const [state, setState] = useState<DeletionState>({ phase: "idle" });
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const flow = useRef<ReturnType<typeof createAccountDeletion> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const headingId = useId();
  const passwordId = useId();
  const consentId = useId();
  // A new account gets a new operation lifetime. Same-ID ABA is independently
  // invalidated by the controller's synchronous store subscription.
  const accountId = user._id;
  useEffect(() => {
    if (!accountId) return;
    setState({ phase: "idle" });
    const controller = createAccountDeletion(setState);
    flow.current = controller;
    return () => {
      controller.dispose();
      flow.current = null;
    };
  }, [accountId]);
  useEffect(() => {
    setPassword("");
    setConsent(false);
    if (state.phase !== "idle") heading.current?.focus();
  }, [state.phase]);
  const activeFlow = flow.current;
  const cancel = () => {
    setPassword("");
    setConsent(false);
    flow.current?.cancel();
  };
  return (
    <section aria-labelledby={headingId} className="space-y-3 border-t pt-4">
      <h3
        id={headingId}
        ref={heading}
        tabIndex={-1}
        className="font-semibold text-destructive"
      >
        {text("title")}
      </h3>
      <p className="text-sm text-muted-foreground">{text("details")}</p>
      {state.message && (
        <p role="status" aria-live="polite" className="text-sm">
          {text(state.message)}
        </p>
      )}
      {state.phase === "idle" && (
        <Button
          className="min-h-11"
          variant="destructive"
          onClick={() => flow.current?.begin()}
        >
          {text("title")}
        </Button>
      )}
      {state.phase === "warning" && (
        <>
          <p className="text-sm">{user.email}</p>
          <Button className="min-h-11" onClick={() => flow.current?.advance()}>
            {text("continue")}
          </Button>
        </>
      )}
      {state.phase === "confirm" && (
        <>
          <p className="text-sm">{user.email}</p>
          <label
            htmlFor={consentId}
            className="flex min-h-11 items-center gap-2 text-sm"
          >
            <input
              id={consentId}
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            {text("consent")}
          </label>
          <Button
            className="min-h-11"
            variant="destructive"
            disabled={!consent}
            onClick={() => {
              if (consent) void flow.current?.confirm();
            }}
          >
            {text("confirm")}
          </Button>
        </>
      )}
      {state.phase === "reauth" && (
        <>
          <p className="text-sm">{user.email}</p>
          {user.authProviders.includes("local") && (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                const secret = password;
                setPassword("");
                void activeFlow?.reauthenticate("local", secret);
              }}
            >
              <label htmlFor={passwordId} className="text-sm">
                {text("password")}
              </label>
              <Input
                id={passwordId}
                type="password"
                autoComplete="current-password"
                value={password}
                required
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button className="min-h-11" type="submit" disabled={!password}>
                {text("passwordSubmit")}
              </Button>
            </form>
          )}
          {user.authProviders.includes("google") && (
            <div className="space-y-2">
              <p className="text-sm">{text("google")}</p>
              <GoogleLogin
                onSuccess={(response) => {
                  if (response.credential)
                    void activeFlow?.reauthenticate(
                      "google",
                      response.credential,
                    );
                }}
                onError={() => activeFlow?.reauthError()}
              />
            </div>
          )}
        </>
      )}
      {state.phase === "busy" && (
        <>
          <p role="status">{text("busy")}</p>
          <p className="text-xs text-muted-foreground">{text("inFlight")}</p>
        </>
      )}
      {["warning", "confirm", "reauth", "busy"].includes(state.phase) && (
        <Button className="min-h-11" variant="outline" onClick={cancel}>
          {text("cancel")}
        </Button>
      )}
    </section>
  );
}
