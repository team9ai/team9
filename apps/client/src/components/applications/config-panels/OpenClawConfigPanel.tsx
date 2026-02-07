import {
  Bot,
  Play,
  Square,
  RotateCw,
  Loader2,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@/services/api";
import { useState } from "react";
import type { AppConfigPanelProps } from "./registry";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";

function statusBadgeVariant(status?: string) {
  switch (status) {
    case "running":
      return "default" as const;
    case "stopped":
      return "secondary" as const;
    case "error":
      return "destructive" as const;
    default:
      return "outline" as const;
  }
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleString();
}

export function OpenClawInstanceTab({ installedApp }: AppConfigPanelProps) {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();
  const appId = installedApp.id;
  const [copiedId, setCopiedId] = useState(false);

  const { data: instanceStatus, isLoading: statusLoading } = useQuery({
    queryKey: ["openclaw-status", workspaceId, appId],
    queryFn: () => api.applications.getOpenClawStatus(appId),
    refetchInterval: 10000,
  });

  const startMutation = useMutation({
    mutationFn: () => api.applications.openClawAction(appId, "start"),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["openclaw-status", workspaceId, appId],
      }),
  });

  const stopMutation = useMutation({
    mutationFn: () => api.applications.openClawAction(appId, "stop"),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["openclaw-status", workspaceId, appId],
      }),
  });

  const restartMutation = useMutation({
    mutationFn: () => api.applications.openClawAction(appId, "restart"),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["openclaw-status", workspaceId, appId],
      }),
  });

  const anyPending =
    startMutation.isPending ||
    stopMutation.isPending ||
    restartMutation.isPending;

  const handleCopyInstanceId = async () => {
    if (instanceStatus?.instanceId) {
      await navigator.clipboard.writeText(instanceStatus.instanceId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Instance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : instanceStatus ? (
          <>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <Badge variant={statusBadgeVariant(instanceStatus.status)}>
                  {instanceStatus.status}
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  Instance ID
                </span>
                <div className="flex items-center gap-1.5">
                  <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono">
                    {instanceStatus.instanceId}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={handleCopyInstanceId}
                  >
                    {copiedId ? <Check size={12} /> : <Copy size={12} />}
                  </Button>
                </div>
              </div>

              {instanceStatus.accessUrl && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Access URL
                  </span>
                  <a
                    href={instanceStatus.accessUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    {instanceStatus.accessUrl}
                    <ExternalLink size={10} />
                  </a>
                </div>
              )}

              {instanceStatus.createdAt && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Created</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(instanceStatus.createdAt)}
                  </span>
                </div>
              )}

              {instanceStatus.lastHeartbeat && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    Last Heartbeat
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(instanceStatus.lastHeartbeat)}
                  </span>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                size="sm"
                disabled={anyPending || instanceStatus.status === "running"}
                onClick={() => startMutation.mutate()}
              >
                {startMutation.isPending ? (
                  <Loader2 size={14} className="mr-1 animate-spin" />
                ) : (
                  <Play size={14} className="mr-1" />
                )}
                Start
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={anyPending || instanceStatus.status === "stopped"}
                onClick={() => stopMutation.mutate()}
              >
                {stopMutation.isPending ? (
                  <Loader2 size={14} className="mr-1 animate-spin" />
                ) : (
                  <Square size={14} className="mr-1" />
                )}
                Stop
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={anyPending}
                onClick={() => restartMutation.mutate()}
              >
                {restartMutation.isPending ? (
                  <Loader2 size={14} className="mr-1 animate-spin" />
                ) : (
                  <RotateCw size={14} className="mr-1" />
                )}
                Restart
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No instance information available
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function OpenClawBotsTab({ installedApp }: AppConfigPanelProps) {
  const navigate = useNavigate();
  const workspaceId = useSelectedWorkspaceId();
  const appId = installedApp.id;

  const { data: bots, isLoading: botsLoading } = useQuery({
    queryKey: ["openclaw-bots", workspaceId, appId],
    queryFn: () => api.applications.getOpenClawBots(appId),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Bot size={16} />
            Bots
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate({ to: "/ai-staff" })}
          >
            Manage
            <ExternalLink size={12} className="ml-1" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {botsLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : bots && bots.length > 0 ? (
          <div className="space-y-4">
            {bots.map((bot) => (
              <div key={bot.botId} className="space-y-3">
                {bots.length > 1 && (
                  <div className="text-sm font-medium">
                    {bot.displayName ?? bot.username}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Name</span>
                  <span className="text-sm font-medium">
                    {bot.displayName ?? bot.username}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Active</span>
                  <Badge variant={bot.isActive ? "default" : "secondary"}>
                    {bot.isActive ? "Yes" : "No"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Created</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(bot.createdAt)}
                  </span>
                </div>
                {bots.length > 1 && <hr className="border-border" />}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No bots found for this application
          </p>
        )}
      </CardContent>
    </Card>
  );
}
