import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/services/api";
import { useMemo, useState, useEffect } from "react";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import { useCurrentWorkspaceRole } from "@/hooks/useWorkspace";
import { useIsUserOnline } from "@/hooks/useIMUsers";

/**
 * Resolves the OpenClaw instance status for a given bot user ID.
 * Used in bot DM channels to detect when the instance is stopped.
 */
export function useOpenClawBotInstanceStatus(botUserId: string | null) {
  const workspaceId = useSelectedWorkspaceId();
  const queryClient = useQueryClient();
  const { isOwnerOrAdmin } = useCurrentWorkspaceRole();
  const isBotOnline = useIsUserOnline(botUserId ?? undefined);

  // Track whether a start was requested, cleared when bot comes online
  const [startRequested, setStartRequested] = useState(false);

  // Clear startRequested once bot comes online
  useEffect(() => {
    if (startRequested && isBotOnline) {
      setStartRequested(false);
    }
  }, [startRequested, isBotOnline]);

  const { data: installedApps } = useQuery({
    queryKey: ["installed-applications", workspaceId],
    queryFn: () => api.applications.getInstalledApplications(),
    enabled: !!botUserId && !!workspaceId,
  });

  const openClawApp = useMemo(
    () =>
      installedApps?.find(
        (a) => a.applicationId === "openclaw" && a.status === "active",
      ),
    [installedApps],
  );
  const appId = openClawApp?.id;

  const { data: bots } = useQuery({
    queryKey: ["openclaw-bots", workspaceId, appId],
    queryFn: () => api.applications.getOpenClawBots(appId!),
    enabled: !!appId,
  });

  const isOpenClawBot = useMemo(
    () => !!bots?.some((b) => b.userId === botUserId),
    [bots, botUserId],
  );

  const { data: instanceStatus } = useQuery({
    queryKey: ["openclaw-status", workspaceId, appId],
    queryFn: () => api.applications.getOpenClawStatus(appId!),
    enabled: !!appId && isOpenClawBot,
    refetchInterval: 8000,
  });

  const startMutation = useMutation({
    mutationFn: () => api.applications.openClawAction(appId!, "start"),
    onSuccess: () => {
      setStartRequested(true);
      queryClient.invalidateQueries({
        queryKey: ["openclaw-status", workspaceId, appId],
      });
    },
  });

  const isInstanceStarting =
    startMutation.isPending || (startRequested && !isBotOnline);

  return {
    instanceStatus,
    isInstanceRunning: instanceStatus?.status === "running",
    isInstanceStopped:
      isOpenClawBot &&
      !!instanceStatus &&
      instanceStatus.status !== "running" &&
      instanceStatus.status !== "creating" &&
      !isInstanceStarting,
    isInstanceStarting,
    isOpenClawBot,
    canStart: isOwnerOrAdmin,
    startInstance: () => startMutation.mutate(),
    isStarting: startMutation.isPending,
  };
}
