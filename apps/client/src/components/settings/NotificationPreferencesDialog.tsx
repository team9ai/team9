import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotificationPreferences } from "@/hooks/useNotificationPreferences";
import { usePushSubscription } from "@/hooks/usePushSubscription";

/** Extract "HH:MM" from an ISO date string or return "" */
function toTimeString(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return "";
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

interface NotificationPreferencesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NotificationPreferencesDialog({
  open,
  onOpenChange,
}: NotificationPreferencesDialogProps) {
  const { t } = useTranslation("settings");
  const { preferences, isLoading, updatePreferences } =
    useNotificationPreferences();
  const { status: pushStatus, subscribe, unsubscribe } = usePushSubscription();

  const [focusSuppression, setFocusSuppression] = useState(() => {
    return localStorage.getItem("notification_focus_suppression") !== "false";
  });

  const handleToggle = async (field: string, value: boolean) => {
    // If toggling desktopEnabled, handle push subscription first
    // to avoid desync: server shows enabled but no subscription exists.
    if (field === "desktopEnabled") {
      if (value) {
        const ok = await subscribe();
        if (!ok) return; // don't persist if subscription failed
      } else {
        await unsubscribe();
      }
    }

    await updatePreferences({ [field]: value });
  };

  const handleFocusSuppression = (value: boolean) => {
    setFocusSuppression(value);
    localStorage.setItem("notification_focus_suppression", String(value));
  };

  const handleDndTimeChange = async (
    field: "dndStart" | "dndEnd",
    value: string,
  ) => {
    if (!value) {
      await updatePreferences({ [field]: null });
      return;
    }
    // Convert "HH:MM" from <input type="time"> to a full ISO string
    // using a fixed date (1970-01-01) so the server can parse it.
    // The server only uses the hours/minutes for DND window comparison.
    const isoValue = `1970-01-01T${value}:00.000Z`;
    await updatePreferences({ [field]: isoValue });
  };

  if (isLoading || !preferences) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md dark:bg-card">
          <DialogHeader>
            <DialogTitle className="dark:text-foreground">
              {t("notificationPreferences")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md dark:bg-card">
        <DialogHeader>
          <DialogTitle className="dark:text-foreground">
            {t("notificationPreferences")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t("notificationPreferences")}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh]">
          <div className="space-y-6 py-4 pr-4">
            {/* Desktop Notifications */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-sm font-medium dark:text-foreground">
                    {t("desktopNotifications")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {pushStatus === "denied" && t("pushPermissionDenied")}
                    {pushStatus === "prompt" && t("pushPermissionPrompt")}
                    {pushStatus === "unsubscribed" && t("pushPermissionPrompt")}
                    {pushStatus === "subscribed" && t("pushEnabled")}
                    {pushStatus === "unsupported" && t("pushUnsupported")}
                  </p>
                </div>
                <Switch
                  checked={preferences.desktopEnabled}
                  disabled={
                    pushStatus === "denied" || pushStatus === "unsupported"
                  }
                  onCheckedChange={(value) =>
                    handleToggle("desktopEnabled", value)
                  }
                />
              </div>
            </div>

            {/* Focus Suppression */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-sm font-medium dark:text-foreground">
                  {t("muteWhenViewing")}
                </Label>
              </div>
              <Switch
                checked={focusSuppression}
                onCheckedChange={handleFocusSuppression}
              />
            </div>

            <Separator />

            {/* Notification Types */}
            <div className="space-y-4">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {t("notificationTypes")}
              </h4>

              <div className="space-y-4">
                {/* Mentions */}
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium dark:text-foreground">
                    {t("mentions")}
                  </Label>
                  <Switch
                    checked={preferences.mentionsEnabled}
                    onCheckedChange={(value) =>
                      handleToggle("mentionsEnabled", value)
                    }
                  />
                </div>

                {/* Replies */}
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium dark:text-foreground">
                    {t("replies")}
                  </Label>
                  <Switch
                    checked={preferences.repliesEnabled}
                    onCheckedChange={(value) =>
                      handleToggle("repliesEnabled", value)
                    }
                  />
                </div>

                {/* Direct Messages */}
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium dark:text-foreground">
                    {t("directMessages")}
                  </Label>
                  <Switch
                    checked={preferences.dmsEnabled}
                    onCheckedChange={(value) =>
                      handleToggle("dmsEnabled", value)
                    }
                  />
                </div>

                {/* System */}
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium dark:text-foreground">
                    {t("systemNotifications")}
                  </Label>
                  <Switch
                    checked={preferences.systemEnabled}
                    onCheckedChange={(value) =>
                      handleToggle("systemEnabled", value)
                    }
                  />
                </div>

                {/* Workspace */}
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium dark:text-foreground">
                    {t("workspaceNotifications")}
                  </Label>
                  <Switch
                    checked={preferences.workspaceEnabled}
                    onCheckedChange={(value) =>
                      handleToggle("workspaceEnabled", value)
                    }
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Sound */}
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-sm font-medium dark:text-foreground">
                  {t("sound")}
                </Label>
              </div>
              <Switch
                checked={preferences.soundEnabled}
                onCheckedChange={(value) => handleToggle("soundEnabled", value)}
              />
            </div>

            <Separator />

            {/* Do Not Disturb */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium dark:text-foreground">
                  {t("doNotDisturb")}
                </Label>
                <Switch
                  checked={preferences.dndEnabled}
                  onCheckedChange={(value) => handleToggle("dndEnabled", value)}
                />
              </div>

              {preferences.dndEnabled && (
                <div className="flex items-center gap-4 pl-1">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">
                      {t("dndStartTime")}
                    </Label>
                    <input
                      type="time"
                      value={toTimeString(preferences.dndStart)}
                      onChange={(e) =>
                        handleDndTimeChange("dndStart", e.target.value)
                      }
                      className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:text-foreground"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs text-muted-foreground">
                      {t("dndEndTime")}
                    </Label>
                    <input
                      type="time"
                      value={toTimeString(preferences.dndEnd)}
                      onChange={(e) =>
                        handleDndTimeChange("dndEnd", e.target.value)
                      }
                      className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring dark:text-foreground"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
