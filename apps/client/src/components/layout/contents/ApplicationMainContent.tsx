import { useTranslation } from "react-i18next";
import {
  LayoutGrid,
  Loader2,
  AlertCircle,
  Bot,
  ChevronRight,
  Plus,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@/services/api";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";

export function ApplicationMainContent() {
  const { t } = useTranslation("navigation");
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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

  const { data: allApps } = useQuery({
    queryKey: ["applications"],
    queryFn: () => api.applications.getApplications(),
  });

  const installMutation = useMutation({
    mutationFn: (applicationId: string) =>
      api.applications.installApplication({ applicationId }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["installed-applications", workspaceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["installed-applications-with-bots", workspaceId],
      });
    },
  });

  const installedAppIds = new Set(
    installedApps?.map((app) => app.applicationId) ?? [],
  );
  const availableApps =
    allApps?.filter(
      (app) => !installedAppIds.has(app.id) && app.type !== "managed",
    ) ?? [];

  const handleAppClick = (appId: string) => {
    navigate({ to: "/application/$appId", params: { appId } });
  };

  return (
    <main className="flex-1 flex flex-col bg-background">
      {/* Content Header */}
      <header className="h-14 bg-background flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <LayoutGrid size={18} className="text-primary" />
          <h2 className="font-semibold text-lg text-foreground">
            {t("appsTitle")}
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
                {t("failedToLoadApps")}
              </p>
            </Card>
          )}

          {!isLoading && !error && (
            <div className="max-w-md space-y-6">
              {/* Installed Apps */}
              {installedApps && installedApps.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
                    {t("installedApps")}
                  </h3>
                  <div className="space-y-1">
                    {installedApps.map((app) => (
                      <div
                        key={app.id}
                        onClick={() => handleAppClick(app.id)}
                        className="flex items-center gap-3 p-5 rounded-lg cursor-pointer bg-muted/50 hover:bg-muted/80 shadow-sm hover:shadow-md transition-all"
                      >
                        <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                          <Bot size={24} className="text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {app.name}
                            </span>
                            <Badge
                              variant={
                                app.status === "active"
                                  ? "default"
                                  : "secondary"
                              }
                              className="text-[10px] px-1.5 py-0 h-4"
                            >
                              {app.status}
                            </Badge>
                          </div>
                          {app.description && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {app.description}
                            </p>
                          )}
                        </div>
                        <ChevronRight
                          size={16}
                          className="text-muted-foreground shrink-0"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Available Apps */}
              {availableApps.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">
                    {t("availableApps")}
                  </h3>
                  <div className="space-y-1">
                    {availableApps.map((app) => (
                      <div
                        key={app.id}
                        className="flex items-center gap-3 p-5 rounded-lg bg-muted/50 shadow-sm"
                      >
                        <div className="w-12 h-12 bg-muted rounded-lg flex items-center justify-center shrink-0">
                          <Bot size={24} className="text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-foreground">
                            {app.name}
                          </span>
                          {app.description && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {app.description}
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={installMutation.isPending}
                          onClick={() => installMutation.mutate(app.id)}
                        >
                          {installMutation.isPending &&
                          installMutation.variables === app.id ? (
                            <Loader2 className="w-4 h-4 animate-spin mr-1" />
                          ) : (
                            <Plus size={14} className="mr-1" />
                          )}
                          {t("install")}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty state */}
              {(!installedApps || installedApps.length === 0) &&
                availableApps.length === 0 && (
                  <Card className="p-6 text-center">
                    <div className="w-16 h-16 mx-auto mb-4 bg-muted rounded-full flex items-center justify-center">
                      <LayoutGrid size={28} className="text-muted-foreground" />
                    </div>
                    <h3 className="font-medium text-foreground mb-1">
                      {t("noAppsAvailable")}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {t("appsWillAppear")}
                    </p>
                  </Card>
                )}
            </div>
          )}
        </div>
      </ScrollArea>
    </main>
  );
}
