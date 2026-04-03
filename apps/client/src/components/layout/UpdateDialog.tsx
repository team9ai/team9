import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDownToLine, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDesktopUpdater } from "@/hooks/useDesktopUpdater";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function UpdateDialog() {
  const { t } = useTranslation("settings");
  const {
    availableUpdate,
    currentVersion,
    isChecking,
    isInstalling,
    isSupported,
    checkForUpdates,
    installUpdate,
  } = useDesktopUpdater();

  const [open, setOpen] = useState(false);

  // Show dialog when a new update is detected — cannot be dismissed
  useEffect(() => {
    if (availableUpdate) {
      setOpen(true);
    }
  }, [availableUpdate]);

  // Auto-check on mount + every hour
  useEffect(() => {
    if (!isSupported) return;

    // Initial check with a short delay so the app can finish loading
    const initialTimer = setTimeout(() => {
      void checkForUpdates();
    }, 5000);

    const interval = setInterval(() => {
      void checkForUpdates();
    }, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [isSupported, checkForUpdates]);

  const handleInstall = useCallback(() => {
    void installUpdate();
  }, [installUpdate]);

  if (!isSupported || !availableUpdate) return null;

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-md"
        hideCloseButton
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>
            {t("updateDialog.title", "Update Available")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "updateDialog.forceDescription",
              "A new version of Team9 is available. You must update to continue using the app.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2">
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-4 py-3">
            <span className="text-sm text-muted-foreground">
              {t("updateDialog.currentVersion", "Current version")}
            </span>
            <span className="font-semibold">v{currentVersion ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-4 py-3">
            <span className="text-sm text-muted-foreground">
              {t("updateDialog.newVersion", "New version")}
            </span>
            <span className="font-semibold text-primary">
              v{availableUpdate.version}
            </span>
          </div>
          {availableUpdate.notes && (
            <div className="rounded-lg border bg-muted/20 px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">
                {t("updateDialog.releaseNotes", "Release notes")}
              </p>
              <p className="mt-1 whitespace-pre-line text-sm">
                {availableUpdate.notes}
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button onClick={handleInstall} disabled={isInstalling || isChecking}>
            {isInstalling ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <ArrowDownToLine className="mr-2 size-4" />
            )}
            {isInstalling
              ? t("updateDialog.installing", "Installing...")
              : t("updateDialog.install", "Install now")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
