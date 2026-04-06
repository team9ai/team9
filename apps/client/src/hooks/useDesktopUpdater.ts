import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriApp } from "@/lib/tauri";

interface DesktopUpdateInfo {
  currentVersion: string;
  version: string;
  notes: string | null;
  pubDate: string | null;
}

export interface DownloadProgress {
  downloaded: number;
  contentLength: number | null;
}

export type DesktopUpdaterStatus = "upToDate" | "downloading" | "installing";
type DesktopUpdaterErrorKey = "notConfigured" | "timeout";

export interface UseDesktopUpdaterResult {
  availableUpdate: DesktopUpdateInfo | null;
  currentVersion: string | null;
  downloadProgress: DownloadProgress | null;
  errorKey: DesktopUpdaterErrorKey | null;
  errorMessage: string | null;
  isChecking: boolean;
  isInstalling: boolean;
  isSupported: boolean;
  status: DesktopUpdaterStatus | null;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
  retryUpdate: () => Promise<void>;
}

const NOT_CONFIGURED_ERROR =
  "Desktop updates are not configured for this build.";
const TIMEOUT_ERROR =
  "Update download timed out. Please check your network connection and try again.";

function getErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong while checking for updates.";
}

function getErrorKey(message: string): DesktopUpdaterErrorKey | null {
  if (message === NOT_CONFIGURED_ERROR) {
    return "notConfigured";
  }
  if (message === TIMEOUT_ERROR) {
    return "timeout";
  }
  return null;
}

export function useDesktopUpdater(): UseDesktopUpdaterResult {
  const isSupported = isTauriApp();
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [availableUpdate, setAvailableUpdate] =
    useState<DesktopUpdateInfo | null>(null);
  const [status, setStatus] = useState<DesktopUpdaterStatus | null>(null);
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgress | null>(null);
  const [errorKey, setErrorKey] = useState<DesktopUpdaterErrorKey | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const isCheckingRef = useRef(false);
  const isInstallingRef = useRef(false);
  const availableUpdateRef = useRef<DesktopUpdateInfo | null>(null);

  useEffect(() => {
    if (!isSupported) {
      return;
    }

    let cancelled = false;

    void invoke<string>("desktop_get_app_version")
      .then((version) => {
        if (!cancelled) {
          setCurrentVersion(version);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentVersion(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isSupported]);

  const checkForUpdates = useCallback(async () => {
    if (!isSupported || isCheckingRef.current || isInstallingRef.current) {
      return;
    }

    try {
      isCheckingRef.current = true;
      setIsChecking(true);
      setErrorKey(null);
      setErrorMessage(null);
      setStatus(null);
      setDownloadProgress(null);

      const update = await invoke<DesktopUpdateInfo | null>(
        "desktop_check_for_update",
      );

      availableUpdateRef.current = update;
      setAvailableUpdate(update);
      setStatus(update ? null : "upToDate");
    } catch (nextError) {
      const nextMessage = getErrorMessage(nextError);
      availableUpdateRef.current = null;
      setAvailableUpdate(null);
      setStatus(null);
      setErrorKey(getErrorKey(nextMessage));
      setErrorMessage(nextMessage);
    } finally {
      isCheckingRef.current = false;
      setIsChecking(false);
    }
  }, [isSupported]);

  const installUpdate = useCallback(async () => {
    if (
      !isSupported ||
      !availableUpdateRef.current ||
      isInstallingRef.current
    ) {
      return;
    }

    const unlisteners: UnlistenFn[] = [];

    try {
      isInstallingRef.current = true;
      setIsInstalling(true);
      setErrorKey(null);
      setErrorMessage(null);
      setStatus("downloading");
      setDownloadProgress(null);

      // Listen for download progress events from Rust
      unlisteners.push(
        await listen<DownloadProgress>("update-download-progress", (event) => {
          setDownloadProgress(event.payload);
        }),
      );

      // Listen for download finished → transition to installing phase
      unlisteners.push(
        await listen("update-download-finished", () => {
          setStatus("installing");
        }),
      );

      await invoke("desktop_install_update");
      // If we reach here, app.restart() was called on the Rust side,
      // so this code path is effectively unreachable on success.
    } catch (nextError) {
      const nextMessage = getErrorMessage(nextError);
      setStatus(null);
      setDownloadProgress(null);
      setErrorKey(getErrorKey(nextMessage));
      setErrorMessage(nextMessage);
    } finally {
      for (const unlisten of unlisteners) {
        unlisten();
      }
      isInstallingRef.current = false;
      setIsInstalling(false);
    }
  }, [isSupported]);

  const retryUpdate = useCallback(async () => {
    // Re-check for the update (re-fetches the Update object on the Rust side)
    // then immediately install
    setErrorKey(null);
    setErrorMessage(null);
    setStatus(null);
    setDownloadProgress(null);

    await checkForUpdates();

    // After re-checking, if an update is available, install it
    if (availableUpdateRef.current) {
      await installUpdate();
    }
  }, [checkForUpdates, installUpdate]);

  return {
    availableUpdate,
    currentVersion,
    downloadProgress,
    errorKey,
    errorMessage,
    isChecking,
    isInstalling,
    isSupported,
    status,
    checkForUpdates,
    installUpdate,
    retryUpdate,
  };
}
