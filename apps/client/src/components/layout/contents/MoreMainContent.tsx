import {
  Settings,
  Palette,
  Globe,
  ChevronRight,
  Users,
  Link2,
  Sun,
  Moon,
  Check,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { InviteManagementDialog } from "@/components/workspace/InviteManagementDialog";
import { NotificationPreferencesDialog } from "@/components/settings/NotificationPreferencesDialog";
import { useWorkspaceStore } from "@/stores";
import { useThemeToggle } from "@/hooks/useTheme";
import { useCurrentWorkspaceRole } from "@/hooks/useWorkspace";
import { supportedLanguages } from "@/i18n";
import { changeLanguage, useLanguageLoading } from "@/i18n/loadLanguage";
import { cn } from "@/lib/utils";

const settingsGroups = [
  {
    titleKey: "workspace",
    items: [
      { id: "invitations", labelKey: "invitations", icon: Link2 },
      { id: "members", labelKey: "members", icon: Users },
    ],
  },
  {
    titleKey: "preferences",
    items: [
      { id: "appearance", labelKey: "appearance", icon: Palette },
      { id: "language", labelKey: "language", icon: Globe },
    ],
  },
];

export function MoreMainContent() {
  const { t, i18n } = useTranslation("settings");
  const { t: tWorkspace } = useTranslation("workspace");
  const navigate = useNavigate();
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [isAppearanceDialogOpen, setIsAppearanceDialogOpen] = useState(false);
  const [isNotificationDialogOpen, setIsNotificationDialogOpen] =
    useState(false);
  const [isLanguageDialogOpen, setIsLanguageDialogOpen] = useState(false);
  const { isLoading: isLanguageLoading } = useLanguageLoading();
  const { theme, setTheme } = useThemeToggle();
  const { isOwnerOrAdmin } = useCurrentWorkspaceRole();

  // Get current selected workspace
  const { selectedWorkspaceId } = useWorkspaceStore();

  const groups = settingsGroups.map((group) => {
    if (group.titleKey !== "workspace" || !isOwnerOrAdmin) {
      return group;
    }

    return {
      ...group,
      items: [
        {
          id: "workspace-settings",
          labelKey: "workspaceSettings" as string,
          icon: Building2,
        },
        ...group.items,
      ],
    };
  });

  const handleSettingClick = (id: string) => {
    if (id === "invitations") {
      setIsInviteDialogOpen(true);
    } else if (id === "members") {
      navigate({ to: "/more/members" });
    } else if (id === "workspace-settings") {
      navigate({ to: "/more/workspace-settings" });
    } else if (id === "appearance") {
      setIsAppearanceDialogOpen(true);
    } else if (id === "notifications") {
      setIsNotificationDialogOpen(true);
    } else if (id === "language") {
      setIsLanguageDialogOpen(true);
    }
  };
  return (
    <main className="h-full flex flex-col overflow-hidden bg-background">
      {/* Content Header */}
      <header className="h-14 bg-background flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Settings size={18} className="text-primary" />
          <h2 className="font-semibold text-lg text-foreground">
            {t("settingsAndMore")}
          </h2>
        </div>
      </header>

      <Separator />

      {/* Settings Content */}
      <ScrollArea className="flex-1 min-h-0 bg-secondary/50">
        <div className="p-4">
          <div className="space-y-6">
            {groups.map((group) => (
              <div key={group.titleKey}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
                  {group.titleKey === "workspace"
                    ? t("workspace")
                    : t("preferences")}
                </h3>
                <Card className="p-2 gap-0">
                  {group.items.map((item, index) => {
                    const Icon = item.icon;
                    const label =
                      item.id === "workspace-settings"
                        ? tWorkspace("workspaceSettings")
                        : t(item.labelKey as never);
                    return (
                      <div key={item.id}>
                        <Button
                          variant="ghost"
                          onClick={() => handleSettingClick(item.id)}
                          className="w-full justify-between h-auto py-3 px-3 hover:bg-accent"
                        >
                          <div className="flex items-center gap-3">
                            <Icon
                              size={18}
                              className="text-muted-foreground shrink-0"
                            />
                            <span className="text-sm font-medium text-foreground">
                              {label}
                            </span>
                          </div>
                          <ChevronRight
                            size={16}
                            className="text-muted-foreground"
                          />
                        </Button>
                        {index < group.items.length - 1 && (
                          <Separator className="my-1" />
                        )}
                      </div>
                    );
                  })}
                </Card>
              </div>
            ))}

            {/* App Info */}
            <Card className="p-6 text-center">
              <img
                src="/team9-block.png"
                alt="Team9"
                loading="lazy"
                width={80}
                height={80}
                className="w-20 h-20 mx-auto mb-6 object-cover rounded-2xl"
              />
              <p className="text-sm text-muted-foreground mb-2">
                {t("version", { version: "1.0.0" })}
              </p>
              <p className="text-xs text-muted-foreground/70">
                {t("copyright", { year: new Date().getFullYear() })}
              </p>
            </Card>
          </div>
        </div>
      </ScrollArea>

      {/* Invite Management Dialog */}
      {selectedWorkspaceId && (
        <InviteManagementDialog
          isOpen={isInviteDialogOpen}
          onClose={() => setIsInviteDialogOpen(false)}
          workspaceId={selectedWorkspaceId}
        />
      )}

      {/* Appearance Dialog */}
      <Dialog
        open={isAppearanceDialogOpen}
        onOpenChange={setIsAppearanceDialogOpen}
      >
        <DialogContent className="sm:max-w-md dark:bg-card">
          <DialogHeader>
            <DialogTitle className="dark:text-foreground">
              {t("theme")}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <button
              onClick={() => setTheme("light")}
              className={`flex flex-col items-center gap-3 p-4 rounded-lg border-2 transition-all ${
                theme === "light"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 dark:border-border"
              }`}
            >
              <div className="w-12 h-12 rounded-full bg-warning/10 flex items-center justify-center">
                <Sun className="w-6 h-6 text-warning" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium dark:text-foreground">
                  {t("lightTheme")}
                </span>
                {theme === "light" && (
                  <Check className="w-4 h-4 text-primary" />
                )}
              </div>
            </button>

            <button
              onClick={() => setTheme("dark")}
              className={`flex flex-col items-center gap-3 p-4 rounded-lg border-2 transition-all ${
                theme === "dark"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 dark:border-border"
              }`}
            >
              <div className="w-12 h-12 rounded-full bg-foreground flex items-center justify-center">
                <Moon className="w-6 h-6 text-muted" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium dark:text-foreground">
                  {t("darkTheme")}
                </span>
                {theme === "dark" && <Check className="w-4 h-4 text-primary" />}
              </div>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Notification Preferences Dialog */}
      <NotificationPreferencesDialog
        open={isNotificationDialogOpen}
        onOpenChange={setIsNotificationDialogOpen}
      />

      {/* Language Dialog */}
      <Dialog
        open={isLanguageDialogOpen}
        onOpenChange={setIsLanguageDialogOpen}
      >
        <DialogContent className="sm:max-w-sm dark:bg-card">
          <DialogHeader>
            <DialogTitle className="dark:text-foreground">
              {t("selectLanguage")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-1 py-2">
            {supportedLanguages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => changeLanguage(lang.code)}
                disabled={isLanguageLoading}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-md hover:bg-accent disabled:opacity-50",
                  i18n.language === lang.code && "bg-accent",
                )}
              >
                <span className="font-medium">{lang.nativeName}</span>
                {i18n.language === lang.code && (
                  <Check className="w-4 h-4 text-primary" />
                )}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
