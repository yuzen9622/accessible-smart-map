"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

/**
 * Public SOS tracking link: `/{lng}/sos/?token=<shareToken>`.
 *
 * The mobile app claims this path (Universal Links / App Links), so with the
 * app installed the OS opens it there. Everyone else lands here and is sent
 * to the map, whose SOS tracker reads `?sos=`.
 */
export default function SosLinkPage() {
  return (
    <Suspense fallback={null}>
      <SosLinkRedirect />
    </Suspense>
  );
}

function SosLinkRedirect() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lng = pathname.split("/")[1] || "zh-TW";
  const token = searchParams.get("token");

  useEffect(() => {
    const target = token
      ? `/${lng}/?sos=${encodeURIComponent(token)}`
      : `/${lng}/`;
    router.replace(target);
  }, [router, lng, token]);

  return null;
}
