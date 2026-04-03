import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { isTauriApp } from "@/lib/tauri";

interface DesktopUpdateInfo {
  currentVersion: string;
  version: string;
  notes: string | null;
  pubDate: string | null;
}

type DesktopUpdaterStatus = "upToDate" | "installing";
type DesktopUpdaterErrorKey = "notConfigured";

interface UseDesktopUpdaterResult {
  availableUpdate: DesktopUpdateInfo | null;
  currentVersion: string | null;
  errorKey: DesktopUpdaterErrorKey | null;
  errorMessage: string | null;
  isChecking: boolean;
  isInstalling: boolean;
  isSupported: boolean;
  status: DesktopUpdaterStatus | null;
  checkForUpdates: () => Promise<void>;
  installUpdate: () => Promise<void>;
}

const NOT_CONFIGURED_ERROR =
  "Desktop updates are not configured for this build.";

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

  return null;
}

export function useDesktopUpdater(): UseDesktopUpdaterResult {
  const isSupported = isTauriApp();
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [availableUpdate, setAvailableUpdate] =
    useState<DesktopUpdateInfo | null>(null);
  const [status, setStatus] = useState<DesktopUpdaterStatus | null>(null);
  const [errorKey, setErrorKey] = useState<DesktopUpdaterErrorKey | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);

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

  const checkForUpdates = async () => {
    if (!isSupported || isChecking || isInstalling) {
      return;
    }

    try {
      setIsChecking(true);
      setErrorKey(null);
      setErrorMessage(null);
      setStatus(null);

      const update = await invoke<DesktopUpdateInfo | null>(
        "desktop_check_for_update",
      );

      setAvailableUpdate(update);
      setStatus(update ? null : "upToDate");
    } catch (nextError) {
      const nextMessage = getErrorMessage(nextError);
      setAvailableUpdate(null);
      setStatus(null);
      setErrorKey(getErrorKey(nextMessage));
      setErrorMessage(nextMessage);
    } finally {
      setIsChecking(false);
    }
  };

  const installUpdate = async () => {
    if (!isSupported || !availableUpdate || isInstalling) {
      return;
    }

    try {
      setIsInstalling(true);
      setErrorKey(null);
      setErrorMessage(null);
      setStatus("installing");
      await invoke("desktop_install_update");
    } catch (nextError) {
      const nextMessage = getErrorMessage(nextError);
      setStatus(null);
      setErrorKey(getErrorKey(nextMessage));
      setErrorMessage(nextMessage);
    } finally {
      setIsInstalling(false);
    }
  };

  return {
    availableUpdate,
    currentVersion,
    errorKey,
    errorMessage,
    isChecking,
    isInstalling,
    isSupported,
    status,
    checkForUpdates,
    installUpdate,
  };
}
