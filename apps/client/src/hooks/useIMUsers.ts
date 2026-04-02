import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/services/api";
import type { InstalledApplicationWithBots } from "@/services/api/applications";
import type { UpdateUserStatusDto } from "@/types/im";
import { useSelectedWorkspaceId } from "@/stores/useWorkspaceStore";
import { syncCurrentUser } from "./useAuth";

/**
 * Hook to search users
 * When query is empty, returns all users (for @mention autocomplete)
 */
export function useSearchUsers(query: string, enabled = true) {
  const workspaceId = useSelectedWorkspaceId();
  return useQuery({
    queryKey: ["im-users", "search", query, workspaceId],
    queryFn: () => api.im.users.searchUsers({ q: query, limit: 20 }),
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
    queryFn: () => api.im.users.getOnlineUsers(),
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
    queryFn: () => api.im.users.getUser(userId!),
    enabled: !!userId,
  });
}

/**
 * Hook to update user status
 */
export function useUpdateStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateUserStatusDto) => api.im.users.updateStatus(data),
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

/**
 * Hook to update the current user's profile
 */
export function useUpdateCurrentUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Parameters<typeof api.im.users.updateMe>[0]) =>
      api.im.users.updateMe(data),
    onSuccess: (user) => {
      syncCurrentUser(user, queryClient);
      queryClient.invalidateQueries({ queryKey: ["im-users", user.id] });
    },
  });
}

/**
 * Hook to fetch the current pending email change
 */
export function usePendingEmailChange() {
  return useQuery({
    queryKey: ["account", "email-change"],
    queryFn: () => api.account.getPendingEmailChange(),
  });
}

/**
 * Hook to start a new email change request
 */
export function useStartEmailChange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Parameters<typeof api.account.startEmailChange>[0]) =>
      api.account.startEmailChange(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account", "email-change"] });
    },
  });
}

/**
 * Hook to resend the current email change confirmation
 */
export function useResendEmailChange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.account.resendEmailChange(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account", "email-change"] });
    },
  });
}

/**
 * Hook to cancel the current email change request
 */
export function useCancelEmailChange() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.account.cancelEmailChange(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["account", "email-change"] });
    },
  });
}
