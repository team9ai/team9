import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import imApi from "@/services/api/im";
import wsService from "@/services/websocket";
import type { UpdateUserStatusDto } from "@/types/im";

/**
 * Hook to search users
 * When query is empty, returns all users (for @mention autocomplete)
 */
export function useSearchUsers(query: string, enabled = true) {
  return useQuery({
    queryKey: ["im-users", "search", query],
    queryFn: () => imApi.users.searchUsers({ q: query, limit: 20 }),
    enabled,
  });
}

/**
 * Hook to get online users
 */
export function useOnlineUsers() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["im-users", "online"],
    queryFn: () => imApi.users.getOnlineUsers(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Listen for real-time status updates
  useEffect(() => {
    const handleUserOnline = ({
      userId,
      status,
    }: {
      userId: string;
      status: string;
    }) => {
      queryClient.setQueryData(
        ["im-users", "online"],
        (old: Record<string, string> | undefined) => {
          return { ...old, [userId]: status };
        },
      );
    };

    const handleUserOffline = ({ userId }: { userId: string }) => {
      queryClient.setQueryData(
        ["im-users", "online"],
        (old: Record<string, string> | undefined) => {
          if (!old) return old;
          const newData = { ...old };
          delete newData[userId];
          return newData;
        },
      );
    };

    const handleUserStatusChanged = ({
      userId,
      status,
    }: {
      userId: string;
      status: string;
    }) => {
      queryClient.setQueryData(
        ["im-users", "online"],
        (old: Record<string, string> | undefined) => {
          return { ...old, [userId]: status };
        },
      );
    };

    wsService.onUserOnline(handleUserOnline);
    wsService.onUserOffline(handleUserOffline);
    wsService.onUserStatusChanged(handleUserStatusChanged);

    return () => {
      wsService.off("user_online", handleUserOnline);
      wsService.off("user_offline", handleUserOffline);
      wsService.off("user_status_changed", handleUserStatusChanged);
    };
  }, [queryClient]);

  return query;
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

  if (!userId) return false;
  return userId in onlineUsers && onlineUsers[userId] === "online";
}
