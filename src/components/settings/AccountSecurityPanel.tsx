"use client";

import { useState } from "react";
import { toast } from "sonner";
import DeleteAccountPanel from "@/components/settings/DeleteAccountPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { changePassword } from "@/lib/api/auth";
import { ApiError } from "@/lib/fetch";
import { validatePassword } from "@/lib/passwordValidation";
import useAuthStore from "@/stores/useAuthStore";
import type { UserDTO } from "@/types/user";

export default function AccountSecurityPanel({ user }: { user: UserDTO }) {
  const hasPassword = user.authProviders.includes("local");
  const setUser = useAuthStore((s) => s.setUser);
  const setSession = useAuthStore((s) => s.setSession);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    setLoading(true);
    try {
      const res = await changePassword(
        newPassword,
        hasPassword ? currentPassword : undefined,
      );
      if (!res.ok) {
        // skipAuthRetry means fetchRequest returns a 401 here instead of
        // throwing — the only case that happens is "current password wrong".
        setError("目前密碼錯誤");
        return;
      }
      if (res.data?.user) setUser(res.data.user);
      if (res.accessToken) setSession({ accessToken: res.accessToken });
      setCurrentPassword("");
      setNewPassword("");
      toast.success(
        hasPassword
          ? "密碼已更新，其他裝置的登入狀態已失效"
          : "已成功新增密碼登入方式",
      );
    } catch (err) {
      if (err instanceof ApiError && err.reason === "PASSWORD_REQUIRED") {
        setError("請輸入目前的密碼");
      } else {
        setError(err instanceof Error ? err.message : "更新密碼失敗");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold">
          {hasPassword ? "變更密碼" : "新增密碼登入方式"}
        </p>
        <p className="text-xs text-muted-foreground">
          {hasPassword
            ? "更新後，其他裝置的登入狀態將會失效"
            : "目前僅能使用 Google 登入，設定密碼後也能用電子郵件登入"}
        </p>
      </div>
      <form className="space-y-3" onSubmit={handleSubmit}>
        {hasPassword && (
          <Input
            type="password"
            placeholder="目前密碼"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        )}
        <Input
          type="password"
          placeholder="新密碼"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" disabled={loading}>
          {hasPassword ? "更新密碼" : "設定密碼"}
        </Button>
      </form>
      <DeleteAccountPanel key={user._id} user={user} />
    </div>
  );
}
