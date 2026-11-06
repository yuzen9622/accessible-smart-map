"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import StatusPage from "@/components/shared/StatusPage";
import { verifyEmail } from "@/lib/api/auth";
import useAuthStore from "@/stores/useAuthStore";

type Status = "verifying" | "success" | "error";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const lng = pathname.split("/")[1] || "zh-TW";
  const token = searchParams.get("token");

  const setUser = useAuthStore((s) => s.setUser);
  const setUserConfig = useAuthStore((s) => s.setUserConfig);
  const setSession = useAuthStore((s) => s.setSession);

  const [status, setStatus] = useState<Status>("verifying");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("驗證連結無效");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await verifyEmail(token);
        if (cancelled) return;
        if (!res.ok) {
          setStatus("error");
          setMessage("驗證連結無效或已過期，請重新申請驗證信");
          return;
        }
        if (res.data?.user) setUser(res.data.user);
        if (res.data?.config) setUserConfig(res.data.config);
        if (res.accessToken) setSession({ accessToken: res.accessToken });
        setStatus("success");
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("驗證連結無效或已過期，請重新申請驗證信");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, setUser, setUserConfig, setSession]);

  if (status === "verifying") {
    return <StatusPage status="pending" title="正在驗證電子郵件…" />;
  }

  if (status === "success") {
    return (
      <StatusPage
        status="success"
        title="電子郵件驗證成功"
        description="您已自動登入"
        primaryAction={{ label: "回到地圖", href: `/${lng}/map/` }}
      />
    );
  }

  return (
    <StatusPage
      status="error"
      title="驗證失敗"
      description={message}
      primaryAction={{ label: "回到首頁", href: `/${lng}/map/` }}
    />
  );
}
