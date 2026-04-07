import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowDownToLine,
  Loader2,
  RotateCw,
} from "lucide-react";
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
import type { DownloadProgress } from "@/hooks/useDesktopUpdater";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DownloadProgressBar({ progress }: { progress: DownloadProgress }) {
  const percentage =
    progress.contentLength != null && progress.contentLength > 0
      ? Math.min(
          100,
          Math.round((progress.downloaded / progress.contentLength) * 100),
        )
      : null;

  return (
    <div className="space-y-2">
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        {percentage != null ? (
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${percentage}%` }}
          />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {formatBytes(progress.downloaded)}
        {progress.contentLength != null && (
          <> / {formatBytes(progress.contentLength)}</>
        )}
        {percentage != null && <> ({percentage}%)</>}
      </p>
    </div>
  );
}

export function UpdateDialog() {
  const { t } = useTranslation("settings");
  const {
    availableUpdate,
    currentVersion,
    downloadProgress,
    errorMessage,
    isChecking,
    isInstalling,
    isSupported,
    status,
    checkForUpdates,
    installUpdate,
    retryUpdate,
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

  const handleRetry = useCallback(() => {
    void retryUpdate();
  }, [retryUpdate]);

  if (!isSupported || !availableUpdate) return null;

  const hasError = !!errorMessage;
  const isDownloading = status === "downloading";
  const isBusy = isInstalling || isChecking;

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

          {isDownloading && downloadProgress && (
            <div className="rounded-lg border bg-muted/20 px-4 py-3">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                {t("updateDialog.downloading", "Downloading update...")}
              </p>
              <DownloadProgressBar progress={downloadProgress} />
            </div>
          )}

          {status === "installing" && (
            <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-foreground">
              {t("updateDialog.installingUpdate", "Installing update...")}
            </div>
          )}

          {hasError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {hasError ? (
            <Button onClick={handleRetry} disabled={isBusy}>
              {isBusy ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RotateCw className="mr-2 size-4" />
              )}
              {t("updateDialog.retry", "Retry")}
            </Button>
          ) : (
            <Button onClick={handleInstall} disabled={isBusy}>
              {isBusy ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <ArrowDownToLine className="mr-2 size-4" />
              )}
              {isBusy
                ? t("updateDialog.installing", "Installing...")
                : t("updateDialog.install", "Install now")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
