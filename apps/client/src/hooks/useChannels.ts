import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import imApi from "@/services/api/im";
import wsService from "@/services/websocket";
import type { CreateChannelDto } from "@/types/im";
import { useSelectedWorkspaceId } from "@/stores";

/**
 * Hook to fetch all user's channels
 */
export function useChannels() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  const query = useQuery({
    queryKey: ["channels", workspaceId],
    queryFn: () => imApi.channels.getChannels(),
    staleTime: 30000,
    enabled: !!workspaceId,
  });

  // Listen for real-time channel updates
  useEffect(() => {
    const handleChannelJoined = () => {
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
    };

    const handleChannelLeft = () => {
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
    };

    const handleChannelCreated = () => {
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
    };

    wsService.on("channel_joined", handleChannelJoined);
    wsService.on("channel_left", handleChannelLeft);
    wsService.on("channel_created", handleChannelCreated);

    return () => {
      wsService.off("channel_joined", handleChannelJoined);
      wsService.off("channel_left", handleChannelLeft);
      wsService.off("channel_created", handleChannelCreated);
    };
  }, [queryClient, workspaceId]);

  return query;
}

/**
 * Hook to get channel details
 */
export function useChannel(channelId: string | undefined) {
  return useQuery({
    queryKey: ["channels", channelId],
    queryFn: () => imApi.channels.getChannel(channelId!),
    enabled: !!channelId,
  });
}

/**
 * Hook to create a new channel
 */
export function useCreateChannel() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: (data: CreateChannelDto) => imApi.channels.createChannel(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
    },
  });
}

/**
 * Hook to create or get a direct message channel
 */
export function useCreateDirectChannel() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: (targetUserId: string) =>
      imApi.channels.createDirectChannel(targetUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
    },
  });
}

/**
 * Hook to mark messages as read
 */
export function useMarkAsRead() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: ({
      channelId,
      messageId,
    }: {
      channelId: string;
      messageId: string;
    }) => imApi.channels.markAsRead(channelId, { messageId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
    },
  });
}

/**
 * Hook to separate channels by type
 */
export function useChannelsByType() {
  const { data: channels = [], ...rest } = useChannels();

  const publicChannels = channels.filter((ch) => ch.type === "public");
  const privateChannels = channels.filter((ch) => ch.type === "private");
  const directChannels = channels.filter((ch) => ch.type === "direct");

  return {
    channels,
    publicChannels,
    privateChannels,
    directChannels,
    ...rest,
  };
}
