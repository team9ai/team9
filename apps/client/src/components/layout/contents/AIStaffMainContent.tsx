import { Bot, Loader2, AlertCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { api } from "@/services/api";
import type { InstalledApplication } from "@/services/api/applications";
import { cn } from "@/lib/utils";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";

function AIStaffCard({ app }: { app: InstalledApplication }) {
  const navigate = useNavigate();
  const workspaceId = useSelectedWorkspaceId();

  const { data: bots } = useQuery({
    queryKey: ["openclaw-bots", workspaceId, app.id],
    queryFn: () => api.applications.getOpenClawBots(app.id),
    enabled: app.applicationId === "openclaw" && app.status === "active",
  });
  const botInfo = bots?.[0];

  const { data: instanceStatus } = useQuery({
    queryKey: ["openclaw-status", workspaceId, app.id],
    queryFn: () => api.applications.getOpenClawStatus(app.id),
    enabled: app.applicationId === "openclaw" && app.status === "active",
  });

  const displayName = botInfo?.displayName || app.name || "AI Staff";
  const isRunning = instanceStatus?.status === "running";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <Card
      onClick={() =>
        navigate({ to: "/ai-staff/$staffId", params: { staffId: app.id } })
      }
      className="p-4 cursor-pointer hover:shadow-md transition-all"
    >
      <div className="flex items-center gap-4">
        {/* Avatar with status indicator */}
        <div className="relative">
          <Avatar className="w-12 h-12">
            <AvatarFallback className="bg-primary/10 text-primary font-semibold text-sm">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div
            className={cn(
              "absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-background",
              isRunning ? "bg-success" : "bg-muted-foreground",
            )}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">
            {displayName}
          </p>
          {botInfo?.username && (
            <p className="text-xs text-muted-foreground truncate">
              @{botInfo.username}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">
            {app.name}
            {instanceStatus && (
              <span
                className={cn(
                  "ml-2",
                  isRunning ? "text-success" : "text-muted-foreground",
                )}
              >
                {instanceStatus.status}
              </span>
            )}
          </p>
        </div>
      </div>
    </Card>
  );
}

export function AIStaffMainContent() {
  const { t } = useTranslation("navigation");
  const workspaceId = useSelectedWorkspaceId();
  const {
    data: installedApps,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["installed-applications", workspaceId],
    queryFn: () => api.applications.getInstalledApplications(),
    enabled: !!workspaceId,
  });

  return (
    <main className="flex-1 flex flex-col bg-background">
      {/* Content Header */}
      <header className="h-14 bg-background flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-primary" />
          <h2 className="font-semibold text-lg text-foreground">
            {t("aiStaff")}
          </h2>
        </div>
      </header>

      <Separator />

      {/* Content */}
      <ScrollArea className="flex-1 bg-secondary/50">
        <div className="p-4">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <Card className="p-6 text-center">
              <AlertCircle className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Failed to load AI Staff
              </p>
            </Card>
          )}

          {!isLoading &&
            !error &&
            installedApps &&
            installedApps.length === 0 && (
              <Card className="p-6 text-center">
                <div className="w-16 h-16 mx-auto mb-4 bg-primary/10 rounded-full flex items-center justify-center">
                  <Bot size={32} className="text-primary" />
                </div>
                <h3 className="font-medium text-foreground mb-1">
                  {t("createFirstAIStaff")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t("aiStaffDescription")}
                </p>
              </Card>
            )}

          {!isLoading &&
            !error &&
            installedApps &&
            installedApps.length > 0 && (
              <div className="max-w-md space-y-2">
                {installedApps.map((app) => (
                  <AIStaffCard key={app.id} app={app} />
                ))}
              </div>
            )}
        </div>
      </ScrollArea>
    </main>
  );
}
