"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { readSosTrackingToken } from "@/lib/sosTracking";

/**
 * Public SOS tracking link: `/{lng}/sos/#token=<shareToken>`.
 *
 * The mobile app claims this path (Universal Links / App Links), so with the
 * app installed the OS opens it there. Everyone else lands here and is sent
 * to the map while the token remains in the URL fragment. Legacy `?token=`
 * links continue to work, but are immediately converted to the fragment form.
 */
export default function SosLinkPage() {
  const router = useRouter();
  const pathname = usePathname();
  const lng = pathname.split("/")[1] || "zh-TW";

  useEffect(() => {
    const token = readSosTrackingToken(window.location, ["token"]);
    const target = token
      ? `/${lng}/#token=${encodeURIComponent(token)}`
      : `/${lng}/`;
    router.replace(target);
  }, [router, lng]);

  return null;
}
