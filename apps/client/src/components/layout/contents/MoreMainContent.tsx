import {
  Settings,
  HelpCircle,
  Info,
  Bell,
  Lock,
  Palette,
  Globe,
  ChevronRight,
  Users,
  Link2,
  Sun,
  Moon,
  Check,
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
import { useWorkspaceStore } from "@/stores";
import { useThemeToggle } from "@/hooks/useTheme";

const settingsGroups = [
  {
    title: "Workspace",
    items: [
      { id: "invitations", label: "Invitations", icon: Link2 },
      { id: "members", label: "Members", icon: Users },
    ],
  },
  {
    title: "Preferences",
    items: [
      { id: "notifications", label: "Notifications", icon: Bell },
      { id: "privacy", label: "Privacy", icon: Lock },
      { id: "appearance", label: "Appearance", icon: Palette },
      { id: "language", label: "Language", icon: Globe },
    ],
  },
  {
    title: "Support",
    items: [
      { id: "help", label: "Help Center", icon: HelpCircle },
      { id: "about", label: "About", icon: Info },
    ],
  },
];

export function MoreMainContent() {
  const { t } = useTranslation("settings");
  const navigate = useNavigate();
  const [isInviteDialogOpen, setIsInviteDialogOpen] = useState(false);
  const [isAppearanceDialogOpen, setIsAppearanceDialogOpen] = useState(false);
  const { theme, setTheme } = useThemeToggle();

  // Get current selected workspace
  const { selectedWorkspaceId } = useWorkspaceStore();

  const handleSettingClick = (id: string) => {
    if (id === "invitations") {
      setIsInviteDialogOpen(true);
    } else if (id === "members") {
      navigate({ to: "/more/members" });
    } else if (id === "appearance") {
      setIsAppearanceDialogOpen(true);
    }
    // Handle other settings...
  };
  return (
    <main className="flex-1 flex flex-col bg-background">
      {/* Content Header */}
      <header className="h-14 bg-background flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Settings size={18} className="text-primary" />
          <h2 className="font-semibold text-lg text-foreground">
            Settings & More
          </h2>
        </div>
      </header>

      <Separator />

      {/* Settings Content */}
      <ScrollArea className="flex-1 bg-secondary/50">
        <div className="p-4">
          <div className="space-y-6">
            {settingsGroups.map((group) => (
              <div key={group.title}>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
                  {group.title}
                </h3>
                <Card className="p-2">
                  {group.items.map((item, index) => {
                    const Icon = item.icon;
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
                              {item.label}
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
              <div className="w-16 h-16 mx-auto mb-4 bg-primary rounded-2xl flex items-center justify-center">
                <span className="text-3xl">🏋</span>
              </div>
              <h3 className="font-semibold text-lg mb-1 text-foreground">
                Weight Watch
              </h3>
              <p className="text-sm text-muted-foreground mb-2">
                Version 1.0.0
              </p>
              <p className="text-xs text-muted-foreground/70">
                © 2025 Weight Watch Team. All rights reserved.
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
    </main>
  );
}
