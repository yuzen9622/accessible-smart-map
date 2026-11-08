"use client";

import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const AuthDialog = dynamic(() => import("./AuthDialog"), { ssr: false });

/** Account links must work even when the mobile account controls are collapsed. */
export default function AuthLinkDialog() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get("authModal") !== "forgot") return;
    setOpen(true);
    const params = new URLSearchParams(window.location.search);
    params.delete("authModal");
    const search = params.toString();
    window.history.replaceState(
      null,
      "",
      `${pathname}${search ? `?${search}` : ""}${window.location.hash}`,
    );
  }, [pathname, searchParams]);

  return <AuthDialog open={open} onOpenChange={setOpen} initialMode="forgot" />;
}
