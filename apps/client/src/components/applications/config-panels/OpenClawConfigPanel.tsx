import {
  Bot,
  Play,
  Square,
  RotateCw,
  Loader2,
  ExternalLink,
  Copy,
  Check,
  Monitor,
  CheckCircle2,
  XCircle,
  Clock,
  HelpCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { SplitButton } from "@/components/ui/split-button";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "@/services/api";
import type { OpenClawDeviceInfo } from "@/services/api/applications";
import { useState } from "react";
import type { AppConfigPanelProps } from "./registry";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";

const PAIRING_HINT_TEXT =
  'For security, each new device or browser must be manually approved before it can access the instance. Visit the Access URL first — you will see a "disconnected (1008): pairing required" message — then come to the Devices tab to approve the request.';

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

  const isRunning = instanceStatus?.status === "running";
  const [restartDialogOpen, setRestartDialogOpen] = useState(false);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);

  const restartDropdownItem = (
    <DropdownMenuItem
      disabled={anyPending}
      onClick={() => setRestartDialogOpen(true)}
    >
      {restartMutation.isPending ? (
        <Loader2 size={14} className="animate-spin" />
      ) : (
        <RotateCw size={14} />
      )}
      Restart
    </DropdownMenuItem>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Instance</CardTitle>
          {!statusLoading && instanceStatus && (
            <>
              {isRunning ? (
                <SplitButton
                  size="sm"
                  variant="secondary"
                  disabled={anyPending}
                  onClick={() => setStopDialogOpen(true)}
                  dropdownContent={restartDropdownItem}
                >
                  {stopMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Square size={14} />
                  )}
                  Stop
                </SplitButton>
              ) : (
                <SplitButton
                  size="sm"
                  disabled={anyPending || isRunning}
                  onClick={() => startMutation.mutate()}
                  dropdownContent={restartDropdownItem}
                >
                  {startMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Play size={14} />
                  )}
                  Start
                </SplitButton>
              )}

              <AlertDialog
                open={stopDialogOpen}
                onOpenChange={setStopDialogOpen}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Stop Instance</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to stop this instance? All active
                      connections will be terminated.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => stopMutation.mutate()}>
                      Stop
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <AlertDialog
                open={restartDialogOpen}
                onOpenChange={setRestartDialogOpen}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Restart Instance</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to restart this instance? All active
                      connections will be temporarily interrupted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => restartMutation.mutate()}>
                      Restart
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : instanceStatus ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant={statusBadgeVariant(instanceStatus.status)}>
                {instanceStatus.status}
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Instance ID</span>
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
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  Access URL
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle
                          size={12}
                          className="text-muted-foreground/60 cursor-help"
                        />
                      </TooltipTrigger>
                      <TooltipContent
                        side="bottom"
                        className="max-w-xs text-xs"
                      >
                        {PAIRING_HINT_TEXT}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
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
            onClick={() =>
              navigate(
                bots?.length === 1
                  ? {
                      to: "/ai-staff/$staffId",
                      params: { staffId: bots[0].botId },
                    }
                  : { to: "/ai-staff" },
              )
            }
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

function deviceStatusBadge(status: string) {
  switch (status) {
    case "approved":
      return { variant: "default" as const, icon: CheckCircle2 };
    case "pending":
      return { variant: "outline" as const, icon: Clock };
    case "rejected":
      return { variant: "destructive" as const, icon: XCircle };
    default:
      return { variant: "secondary" as const, icon: Monitor };
  }
}

export function OpenClawDevicesTab({ installedApp }: AppConfigPanelProps) {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();
  const appId = installedApp.id;

  const { data: instanceStatus } = useQuery({
    queryKey: ["openclaw-status", workspaceId, appId],
    queryFn: () => api.applications.getOpenClawStatus(appId),
    refetchInterval: 10000,
  });

  const { data: devices, isLoading } = useQuery({
    queryKey: ["openclaw-devices", workspaceId, appId],
    queryFn: () => api.applications.getOpenClawDevices(appId),
    refetchInterval: 10000,
  });

  const approveMutation = useMutation({
    mutationFn: (requestId: string) =>
      api.applications.approveOpenClawDevice(appId, requestId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["openclaw-devices", workspaceId, appId],
      }),
  });

  const rejectMutation = useMutation({
    mutationFn: (requestId: string) =>
      api.applications.rejectOpenClawDevice(appId, requestId),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["openclaw-devices", workspaceId, appId],
      }),
  });

  const pendingDevices = devices?.filter((d) => d.status === "pending") ?? [];
  const otherDevices = devices?.filter((d) => d.status !== "pending") ?? [];

  return (
    <div className="space-y-4">
      {/* Pairing description */}
      <div className="rounded-md bg-muted/50 border px-3 py-2.5">
        <p className="text-xs text-foreground/70 leading-relaxed">
          For security, each new device or browser must be manually approved
          before it can access the instance. Visit the{" "}
          {instanceStatus?.accessUrl ? (
            <a
              href={instanceStatus.accessUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-0.5"
            >
              Access URL
              <ExternalLink size={9} />
            </a>
          ) : (
            "Access URL"
          )}{" "}
          first — you will see a "disconnected (1008): pairing required" message
          — then come to the Devices tab to approve the request.
        </p>
      </div>

      {/* Pending Requests */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock size={16} />
            Pending Requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : pendingDevices.length > 0 ? (
            <div className="space-y-3">
              {pendingDevices.map((device) => (
                <DeviceRow
                  key={device.request_id}
                  device={device}
                  onApprove={() => approveMutation.mutate(device.request_id)}
                  onReject={() => rejectMutation.mutate(device.request_id)}
                  isPending={
                    approveMutation.isPending || rejectMutation.isPending
                  }
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No pending pairing requests
            </p>
          )}
        </CardContent>
      </Card>

      {/* Paired Devices */}
      {otherDevices.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Monitor size={16} />
              Paired Devices
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {otherDevices.map((device) => {
                const { variant, icon: StatusIcon } = deviceStatusBadge(
                  device.status,
                );
                return (
                  <div
                    key={device.request_id}
                    className="flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <Monitor size={14} className="text-muted-foreground" />
                      <span className="text-sm">
                        {device.name || device.request_id}
                      </span>
                    </div>
                    <Badge
                      variant={variant}
                      className="flex items-center gap-1"
                    >
                      <StatusIcon size={10} />
                      {device.status}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DeviceRow({
  device,
  onApprove,
  onReject,
  isPending,
}: {
  device: OpenClawDeviceInfo;
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border p-3">
      <div className="flex items-center gap-2 min-w-0">
        <Monitor size={14} className="text-muted-foreground shrink-0" />
        <span className="text-sm truncate">
          {device.name || device.request_id}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="default"
          disabled={isPending}
          onClick={onApprove}
        >
          <CheckCircle2 size={14} className="mr-1" />
          Approve
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="outline" disabled={isPending}>
              <XCircle size={14} className="mr-1" />
              Reject
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reject Device</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to reject this pairing request from "
                {device.name || device.request_id}"?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onReject}>Reject</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
