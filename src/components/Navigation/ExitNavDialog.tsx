"use client";

import { AlertTriangle, Navigation } from "lucide-react";
import { useAppTranslation } from "@/i18n/client";
import { stopNavigation } from "@/lib/navigation/navigationLifecycle";
import useMapStore from "@/stores/useMapStore";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export default function ExitNavDialog() {
  const { t } = useAppTranslation();
  const pendingNavExit = useMapStore((s) => s.pendingNavExit);
  const confirmNavExit = useMapStore((s) => s.confirmNavExit);
  const cancelNavExit = useMapStore((s) => s.cancelNavExit);

  return (
    <Dialog
      open={pendingNavExit !== null}
      onOpenChange={(open) => !open && cancelNavExit()}
    >
      <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden pointer-events-auto">
        <div className="bg-primary/5 dark:bg-primary/10 px-6 pt-6 pb-4 flex flex-col items-center text-center gap-3">
          <div className="h-14 w-14 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
            <Navigation className="h-7 w-7 text-amber-600 dark:text-amber-400" />
          </div>
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">
              {t("exitNavTitle")}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
              {t("exitNavMessage")}
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="px-6 pb-6 pt-4 flex gap-3">
          <Button
            autoFocus
            variant="outline"
            className="flex-1 rounded-xl h-11"
            onClick={cancelNavExit}
          >
            {t("exitNavCancel")}
          </Button>
          <Button
            variant="destructive"
            className="flex-1 rounded-xl h-11 gap-1.5"
            onClick={() => {
              stopNavigation();
              confirmNavExit();
            }}
          >
            <AlertTriangle className="h-4 w-4" />
            {t("exitNavConfirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
