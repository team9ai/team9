import {
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { useEffect } from "react";
import imApi from "@/services/api/im";
import wsService from "@/services/websocket";
import type { CreateMessageDto, UpdateMessageDto, Message } from "@/types/im";
import { useSelectedWorkspaceId } from "@/stores";

/**
 * Hook to fetch messages for a channel with infinite scroll
 */
export function useMessages(channelId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useInfiniteQuery({
    queryKey: ["messages", channelId],
    queryFn: ({ pageParam }) =>
      imApi.messages.getMessages(channelId!, {
        limit: 50,
        before: pageParam,
      }),
    getNextPageParam: (lastPage) => {
      if (lastPage.length === 0) return undefined;
      return lastPage[lastPage.length - 1].id;
    },
    initialPageParam: undefined as string | undefined,
    enabled: !!channelId,
  });

  // Listen for real-time message updates
  useEffect(() => {
    if (!channelId) return;

    // Join the channel room to receive real-time messages
    wsService.joinChannel(channelId);

    const handleNewMessage = (message: Message) => {
      if (message.channelId !== channelId) return;

      queryClient.setQueryData(["messages", channelId], (old: any) => {
        if (!old) return { pages: [[message]], pageParams: [undefined] };

        // Check if message already exists (might have been added via onSuccess)
        const exists = old.pages.some((page: Message[]) =>
          page.some((msg) => msg.id === message.id),
        );
        if (exists) return old;

        return {
          ...old,
          pages: [[message, ...old.pages[0]], ...old.pages.slice(1)],
        };
      });
    };

    const handleMessageUpdated = (message: Message) => {
      if (message.channelId !== channelId) return;

      queryClient.setQueryData(["messages", channelId], (old: any) => {
        if (!old) return old;

        return {
          ...old,
          pages: old.pages.map((page: Message[]) =>
            page.map((msg) => (msg.id === message.id ? message : msg)),
          ),
        };
      });
    };

    const handleMessageDeleted = ({ messageId }: { messageId: string }) => {
      queryClient.setQueryData(["messages", channelId], (old: any) => {
        if (!old) return old;

        return {
          ...old,
          pages: old.pages.map((page: Message[]) =>
            page.map((msg) =>
              msg.id === messageId ? { ...msg, isDeleted: true } : msg,
            ),
          ),
        };
      });
    };

    wsService.onNewMessage(handleNewMessage);
    wsService.onMessageUpdated(handleMessageUpdated);
    wsService.onMessageDeleted(handleMessageDeleted);

    return () => {
      wsService.off("new_message", handleNewMessage);
      wsService.off("message_updated", handleMessageUpdated);
      wsService.off("message_deleted", handleMessageDeleted);
    };
  }, [channelId, queryClient]);

  return query;
}

/**
 * Hook to send a message
 */
export function useSendMessage(channelId: string) {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: (data: CreateMessageDto) =>
      imApi.messages.sendMessage(channelId!, data),
    onSuccess: (newMessage) => {
      // Immediately add the message to the cache for instant display
      queryClient.setQueryData(["messages", channelId], (old: any) => {
        if (!old) return { pages: [[newMessage]], pageParams: [undefined] };

        // Check if message already exists (might have been added via WebSocket)
        const exists = old.pages.some((page: Message[]) =>
          page.some((msg) => msg.id === newMessage.id),
        );
        if (exists) return old;

        return {
          ...old,
          pages: [[newMessage, ...old.pages[0]], ...old.pages.slice(1)],
        };
      });
      // Invalidate channels to update unread counts
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
    },
  });
}

/**
 * Hook to update a message
 */
export function useUpdateMessage() {
  return useMutation({
    mutationFn: ({
      messageId,
      data,
    }: {
      messageId: string;
      data: UpdateMessageDto;
    }) => imApi.messages.updateMessage(messageId, data),
  });
}

/**
 * Hook to delete a message
 */
export function useDeleteMessage() {
  return useMutation({
    mutationFn: (messageId: string) => imApi.messages.deleteMessage(messageId),
  });
}

/**
 * Hook to add a reaction
 */
export function useAddReaction() {
  return useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      imApi.messages.addReaction(messageId, { emoji }),
  });
}

/**
 * Hook to remove a reaction
 */
export function useRemoveReaction() {
  return useMutation({
    mutationFn: ({ messageId, emoji }: { messageId: string; emoji: string }) =>
      imApi.messages.removeReaction(messageId, emoji),
  });
}
