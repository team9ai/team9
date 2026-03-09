import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  X,
  Loader2,
  Trash2,
  Monitor,
  Key,
  Clock,
  User,
  ListChecks,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { resourcesApi } from "@/services/api/resources";
import type {
  ApiResourceConfig,
  AgentComputerConfig,
  ResourceUsageLog,
  ResourceStatus,
} from "@/types/resource";

interface ResourceDetailPanelProps {
  resourceId: string;
  onClose: () => void;
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

const STATUS_BADGE_VARIANT: Record<
  ResourceStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  online: "default",
  offline: "secondary",
  error: "destructive",
  configuring: "outline",
};

export function ResourceDetailPanel({
  resourceId,
  onClose,
}: ResourceDetailPanelProps) {
  const { t } = useTranslation("resources");
  const queryClient = useQueryClient();

  const {
    data: resource,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["resource", resourceId],
    queryFn: () => resourcesApi.getById(resourceId),
  });

  const { data: usageLogs = [] } = useQuery({
    queryKey: ["resource-usage-logs", resourceId],
    queryFn: () => resourcesApi.getUsageLogs(resourceId, { limit: 20 }),
    enabled: !!resource,
  });

  const deleteMutation = useMutation({
    mutationFn: () => resourcesApi.delete(resourceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources"] });
      onClose();
    },
  });

  return (
    <div className="border-l bg-background flex flex-col h-full w-[400px]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h3 className="text-sm font-semibold truncate">{t("detail.title")}</h3>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X size={16} />
        </Button>
      </div>

      {/* Content */}
      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {isError && (
        <div className="flex-1 flex items-center justify-center px-4">
          <p className="text-sm text-muted-foreground">
            {t("detail.loadError")}
          </p>
        </div>
      )}

      {resource && !isLoading && (
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-5">
            {/* Basic info */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant={STATUS_BADGE_VARIANT[resource.status]}
                  className="text-xs"
                >
                  {t(`status.${resource.status}`)}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  {t(`type.${resource.type}`)}
                </Badge>
              </div>
              <h2 className="text-base font-semibold leading-tight">
                {resource.name}
              </h2>
              {resource.description && (
                <p className="text-sm text-muted-foreground">
                  {resource.description}
                </p>
              )}

              {/* Type-specific config display */}
              {resource.type === "agent_computer" && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <div className="flex items-center gap-2">
                    <Monitor size={12} />
                    <span>
                      {t(
                        `connectionType.${(resource.config as AgentComputerConfig).connectionType}`,
                      )}
                    </span>
                  </div>
                  {(resource.config as AgentComputerConfig).host && (
                    <div>
                      Host: {(resource.config as AgentComputerConfig).host}
                      {(resource.config as AgentComputerConfig).port &&
                        `:${(resource.config as AgentComputerConfig).port}`}
                    </div>
                  )}
                  {(resource.config as AgentComputerConfig).os && (
                    <div>
                      OS: {(resource.config as AgentComputerConfig).os}
                      {(resource.config as AgentComputerConfig).arch &&
                        ` (${(resource.config as AgentComputerConfig).arch})`}
                    </div>
                  )}
                  {resource.lastHeartbeatAt && (
                    <div className="flex items-center gap-1">
                      <Clock size={12} />
                      {t("detail.lastHeartbeat", {
                        time: new Date(
                          resource.lastHeartbeatAt,
                        ).toLocaleString(),
                      })}
                    </div>
                  )}
                </div>
              )}

              {resource.type === "api" && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <div className="flex items-center gap-2">
                    <Key size={12} />
                    <span>
                      {(resource.config as ApiResourceConfig).provider}
                    </span>
                  </div>
                  <div>
                    API Key:{" "}
                    <code>
                      {maskApiKey(
                        (resource.config as ApiResourceConfig).apiKey,
                      )}
                    </code>
                  </div>
                  {(resource.config as ApiResourceConfig).baseUrl && (
                    <div>
                      Base URL: {(resource.config as ApiResourceConfig).baseUrl}
                    </div>
                  )}
                  {(resource.config as ApiResourceConfig).model && (
                    <div>
                      Model: {(resource.config as ApiResourceConfig).model}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Delete button */}
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (window.confirm(t("detail.deleteConfirm"))) {
                  deleteMutation.mutate();
                }
              }}
            >
              <Trash2 size={14} />
              {t("detail.delete")}
            </Button>

            <Separator />

            {/* Authorizations */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">
                {t("detail.authorizations")}
              </h4>
              {(!resource.authorizations ||
                resource.authorizations.length === 0) && (
                <p className="text-xs text-muted-foreground">
                  {t("detail.noAuthorizations")}
                </p>
              )}
              {resource.authorizations?.map((auth) => (
                <div
                  key={`${auth.granteeType}-${auth.granteeId}`}
                  className="flex items-center gap-2 text-xs p-2 rounded border border-border"
                >
                  {auth.granteeType === "user" ? (
                    <User size={12} className="text-muted-foreground" />
                  ) : (
                    <ListChecks size={12} className="text-muted-foreground" />
                  )}
                  <span className="flex-1 truncate">
                    {t(`detail.granteeType.${auth.granteeType}`)}:{" "}
                    {auth.granteeId.slice(0, 8)}...
                  </span>
                  <Badge variant="outline" className="text-xs">
                    {t(`detail.permissionLevel.${auth.permissions.level}`)}
                  </Badge>
                </div>
              ))}
            </div>

            <Separator />

            {/* Usage logs */}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">{t("detail.usageLogs")}</h4>
              {usageLogs.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("detail.noUsageLogs")}
                </p>
              )}
              {usageLogs.map((log: ResourceUsageLog) => (
                <div
                  key={log.id}
                  className="text-xs p-2 rounded border border-border space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">
                      {t(`actions.${log.action}`, {
                        defaultValue: log.action,
                      })}
                    </Badge>
                    <span className="text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-muted-foreground">
                    {log.actorType}: {log.actorId.slice(0, 8)}...
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
