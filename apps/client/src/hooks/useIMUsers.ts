import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import imApi from "@/services/api/im";
import { api } from "@/services/api";
import type { InstalledApplicationWithBots } from "@/services/api/applications";
import type { UpdateUserStatusDto } from "@/types/im";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";

/**
 * Hook to search users
 * When query is empty, returns all users (for @mention autocomplete)
 */
export function useSearchUsers(query: string, enabled = true) {
  const workspaceId = useSelectedWorkspaceId();
  return useQuery({
    queryKey: ["im-users", "search", query, workspaceId],
    queryFn: () => imApi.users.searchUsers({ q: query, limit: 20 }),
    enabled,
  });
}

/**
 * Hook to get online users
 *
 * Note: WebSocket event listeners for real-time status updates are now
 * centralized in useWebSocketEvents hook (called once in _authenticated layout).
 */
export function useOnlineUsers() {
  return useQuery({
    queryKey: ["im-users", "online"],
    queryFn: () => imApi.users.getOnlineUsers(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

export function getAlwaysOnlineBaseModelBotUserIds(
  apps: InstalledApplicationWithBots[] | undefined,
) {
  const userIds = new Set<string>();

  for (const app of apps ?? []) {
    if (app.applicationId !== "base-model-staff") continue;

    for (const bot of app.bots) {
      if ("managedMeta" in bot && bot.userId) {
        userIds.add(bot.userId);
      }
    }
  }

  return userIds;
}

export function useAlwaysOnlineBaseModelBotUserIds() {
  const workspaceId = useSelectedWorkspaceId();
  const { data: installedApps } = useQuery({
    queryKey: ["installed-applications-with-bots", workspaceId],
    queryFn: () => api.applications.getInstalledApplicationsWithBots(),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });

  return useMemo(
    () => getAlwaysOnlineBaseModelBotUserIds(installedApps),
    [installedApps],
  );
}

/**
 * Hook to get user profile
 */
export function useIMUser(userId: string | undefined) {
  return useQuery({
    queryKey: ["im-users", userId],
    queryFn: () => imApi.users.getUser(userId!),
    enabled: !!userId,
  });
}

/**
 * Hook to update user status
 */
export function useUpdateStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateUserStatusDto) => imApi.users.updateStatus(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["im-users", "online"] });
    },
  });
}

/**
 * Hook to check if a user is online
 */
export function useIsUserOnline(userId: string | undefined) {
  const { data: onlineUsers = {} } = useOnlineUsers();
  const alwaysOnlineBotUserIds = useAlwaysOnlineBaseModelBotUserIds();

  if (!userId) return false;
  return (
    alwaysOnlineBotUserIds.has(userId) ||
    (userId in onlineUsers && onlineUsers[userId] === "online")
  );
}
