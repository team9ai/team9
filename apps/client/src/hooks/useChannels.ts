import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import imApi from "@/services/api/im";
import wsService from "@/services/websocket";
import type {
  CreateChannelDto,
  UpdateChannelDto,
  DeleteChannelDto,
} from "@/types/im";
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

    const handleChannelDeleted = () => {
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
    };

    const handleChannelArchived = () => {
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
    };

    const handleChannelUnarchived = () => {
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
    };

    wsService.on("channel_joined", handleChannelJoined);
    wsService.on("channel_left", handleChannelLeft);
    wsService.on("channel_created", handleChannelCreated);
    wsService.on("channel_deleted", handleChannelDeleted);
    wsService.on("channel_archived", handleChannelArchived);
    wsService.on("channel_unarchived", handleChannelUnarchived);

    return () => {
      wsService.off("channel_joined", handleChannelJoined);
      wsService.off("channel_left", handleChannelLeft);
      wsService.off("channel_created", handleChannelCreated);
      wsService.off("channel_deleted", handleChannelDeleted);
      wsService.off("channel_archived", handleChannelArchived);
      wsService.off("channel_unarchived", handleChannelUnarchived);
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

  const publicChannels = channels.filter(
    (ch) => ch.type === "public" && !ch.isArchived,
  );
  const privateChannels = channels.filter(
    (ch) => ch.type === "private" && !ch.isArchived,
  );
  const directChannels = channels.filter((ch) => ch.type === "direct");
  const archivedChannels = channels.filter((ch) => ch.isArchived);

  return {
    channels,
    publicChannels,
    privateChannels,
    directChannels,
    archivedChannels,
    ...rest,
  };
}

/**
 * Hook to update a channel
 */
export function useUpdateChannel() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: ({
      channelId,
      data,
    }: {
      channelId: string;
      data: UpdateChannelDto;
    }) => imApi.channels.updateChannel(channelId, data),
    onSuccess: (_, { channelId }) => {
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
      queryClient.invalidateQueries({ queryKey: ["channels", channelId] });
    },
  });
}

/**
 * Hook to delete/archive a channel
 */
export function useDeleteChannel() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: ({
      channelId,
      data,
    }: {
      channelId: string;
      data?: DeleteChannelDto;
    }) => imApi.channels.deleteChannel(channelId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
    },
  });
}

/**
 * Hook to unarchive a channel
 */
export function useUnarchiveChannel() {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: (channelId: string) =>
      imApi.channels.unarchiveChannel(channelId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
    },
  });
}

/**
 * Hook to get channel members
 */
export function useChannelMembers(channelId: string | undefined) {
  return useQuery({
    queryKey: ["channels", channelId, "members"],
    queryFn: () => imApi.channels.getMembers(channelId!),
    enabled: !!channelId,
  });
}
