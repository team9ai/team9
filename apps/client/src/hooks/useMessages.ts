import {
  useMutation,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { useEffect } from "react";
import imApi from "@/services/api/im";
import wsService from "@/services/websocket";
import type {
  CreateMessageDto,
  UpdateMessageDto,
  Message,
  MessageSendStatus,
} from "@/types/im";
import { useSelectedWorkspaceId } from "@/stores";
import { useThreadStore } from "./useThread";
import { useThreadScrollState } from "./useThreadScrollState";

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

      // If message is a reply (has parentId), don't add to main message list
      // Instead, handle thread updates via state machine
      if (message.parentId) {
        const rootId = message.rootId || message.parentId;
        const parentId = message.parentId;
        const threadState = useThreadStore.getState();
        const scrollStateStore = useThreadScrollState.getState();

        // Check if this reply belongs to any currently open thread (primary or secondary)
        // Primary thread uses rootId (original root message)
        // Secondary thread uses parentId (first-level reply that was opened as a thread)
        const isPrimaryThreadOpen =
          threadState.primaryThread.isOpen &&
          threadState.primaryThread.rootMessageId === rootId;
        const isSecondaryThreadOpen =
          threadState.secondaryThread.isOpen &&
          threadState.secondaryThread.rootMessageId === parentId;

        // Check if this is a sub-reply (reply to a first-level reply, not directly to root)
        const isSubReply = parentId !== rootId;

        // Determine if this message is a direct reply to secondaryThread
        // (i.e., the parentId matches the secondaryThread's rootMessageId)
        // In this case, primaryThread should NOT show new message indicator
        // because the user is already viewing the secondaryThread
        const isMessageForSecondaryThread = isSecondaryThreadOpen;

        // Handle primary thread updates
        // Only notify primaryThread if the message is NOT for the secondaryThread
        if (isPrimaryThreadOpen && !isMessageForSecondaryThread) {
          // If this is a sub-reply and secondaryThread is not open for this parent,
          // increment unread count for that reply instead of showing new message indicator
          if (isSubReply) {
            // Track unread sub-reply for this parent message
            useThreadStore.getState().incrementUnreadSubReplyCount(parentId);
            // Still invalidate the thread query so data is fresh when user opens it
            queryClient.invalidateQueries({
              queryKey: ["thread", rootId],
              refetchType: "all",
            });
          } else {
            // Direct reply to root - show new message indicator as before
            const threadScrollState = scrollStateStore.getThreadState(rootId);
            const currentScrollState = threadScrollState.state;

            // Send event to state machine first
            scrollStateStore.send(rootId, { type: "NEW_MESSAGE" });

            // Only auto-refresh if user is confirmed at bottom (idle state)
            if (currentScrollState === "idle") {
              queryClient.invalidateQueries({
                queryKey: ["thread", rootId],
                refetchType: "all",
              });
            }
          }
        }

        // Handle secondary thread updates (separate from primary)
        if (isSecondaryThreadOpen) {
          const secondaryRootId = threadState.secondaryThread.rootMessageId!;
          const threadScrollState =
            scrollStateStore.getThreadState(secondaryRootId);
          const currentScrollState = threadScrollState.state;

          // Send event to state machine for secondary thread
          scrollStateStore.send(secondaryRootId, { type: "NEW_MESSAGE" });

          // Only auto-refresh if user is confirmed at bottom (idle state)
          if (currentScrollState === "idle") {
            // Secondary thread uses subReplies query, not thread query
            queryClient.invalidateQueries({
              queryKey: ["subReplies", secondaryRootId],
              refetchType: "all",
            });
          }
        }

        // If neither thread is open, just invalidate for when user opens it
        if (!isPrimaryThreadOpen && !isSecondaryThreadOpen) {
          queryClient.invalidateQueries({
            queryKey: ["thread", rootId],
            refetchType: "all",
          });
        }

        // Update the parent message's replyCount in the main list
        queryClient.setQueryData(["messages", channelId], (old: any) => {
          if (!old) return old;

          return {
            ...old,
            pages: old.pages.map((page: Message[]) =>
              page.map((msg) => {
                if (msg.id === rootId) {
                  return { ...msg, replyCount: (msg.replyCount || 0) + 1 };
                }
                return msg;
              }),
            ),
          };
        });
        return;
      }

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
 * Hook to send a message with optimistic updates
 */
export function useSendMessage(channelId: string) {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: (data: CreateMessageDto) =>
      imApi.messages.sendMessage(channelId!, data),

    onMutate: async (newMessageData) => {
      // Cancel any outgoing refetches to prevent overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: ["messages", channelId] });

      // Snapshot the previous value for rollback
      const previousMessages = queryClient.getQueryData([
        "messages",
        channelId,
      ]);

      // Get current user from app store
      const { useAppStore } = await import("@/stores/useAppStore");
      const currentUser = useAppStore.getState().user;

      // Generate a temporary ID for the optimistic message
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

      // Create optimistic message with 'sending' status
      const optimisticMessage: Message = {
        id: tempId,
        channelId,
        senderId: currentUser?.id || "",
        content: newMessageData.content,
        type: "text",
        isPinned: false,
        isEdited: false,
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sender: currentUser
          ? {
              id: currentUser.id,
              email: currentUser.email,
              username: currentUser.name,
              displayName: currentUser.name,
              avatarUrl: currentUser.avatarUrl,
              status: "online",
              isActive: true,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : undefined,
        // For optimistic update, we create placeholder attachments
        // They will be replaced with full data from server response
        attachments: newMessageData.attachments?.map((att, index) => ({
          id: `temp-att-${index}`,
          messageId: tempId,
          fileKey: att.fileKey,
          fileName: att.fileName,
          fileUrl: "", // Will be populated by server
          fileSize: att.fileSize,
          mimeType: att.mimeType,
          createdAt: new Date().toISOString(),
        })),
        reactions: [],
        replyCount: 0,
        sendStatus: "sending" as MessageSendStatus,
        _retryData: newMessageData,
      };

      // Optimistically add the message to the cache
      queryClient.setQueryData(["messages", channelId], (old: any) => {
        if (!old)
          return { pages: [[optimisticMessage]], pageParams: [undefined] };

        return {
          ...old,
          pages: [[optimisticMessage, ...old.pages[0]], ...old.pages.slice(1)],
        };
      });

      // Return context for rollback and replacement
      return { previousMessages, tempId };
    },

    onSuccess: (serverMessage, _, context) => {
      // Replace the optimistic message with the real one from server
      queryClient.setQueryData(["messages", channelId], (old: any) => {
        if (!old) return { pages: [[serverMessage]], pageParams: [undefined] };

        // Check if server message already exists (added by WebSocket)
        const serverMessageExists = old.pages.some((page: Message[]) =>
          page.some((msg: Message) => msg.id === serverMessage.id),
        );

        return {
          ...old,
          pages: old.pages.map((page: Message[], pageIndex: number) => {
            if (pageIndex === 0) {
              const tempIndex = page.findIndex(
                (msg) => msg.id === context?.tempId,
              );

              if (tempIndex !== -1) {
                // Found temp message - replace or remove it
                if (serverMessageExists) {
                  // Server message already added by WebSocket, just remove temp
                  return page.filter((msg) => msg.id !== context?.tempId);
                } else {
                  // Replace temp message with server message
                  const newPage = [...page];
                  newPage[tempIndex] = serverMessage;
                  return newPage;
                }
              }

              // Temp message not found (edge case)
              if (!serverMessageExists) {
                return [serverMessage, ...page];
              }
            }
            return page;
          }),
        };
      });

      // Invalidate channels to update unread counts
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
    },

    onError: (_err, variables, context) => {
      // Mark the optimistic message as failed instead of rolling back
      if (context?.tempId) {
        queryClient.setQueryData(["messages", channelId], (old: any) => {
          if (!old) return old;

          return {
            ...old,
            pages: old.pages.map((page: Message[]) =>
              page.map((msg) =>
                msg.id === context.tempId
                  ? {
                      ...msg,
                      sendStatus: "failed" as MessageSendStatus,
                      _retryData: variables,
                    }
                  : msg,
              ),
            ),
          };
        });
      }
    },
  });
}

/**
 * Hook to retry sending a failed message
 */
export function useRetryMessage(channelId: string) {
  const queryClient = useQueryClient();
  const workspaceId = useSelectedWorkspaceId();

  return useMutation({
    mutationFn: async ({
      retryData,
    }: {
      tempId: string;
      retryData: CreateMessageDto;
    }) => {
      return imApi.messages.sendMessage(channelId, retryData);
    },

    onMutate: async ({ tempId }) => {
      // Mark message as sending again
      queryClient.setQueryData(["messages", channelId], (old: any) => {
        if (!old) return old;

        return {
          ...old,
          pages: old.pages.map((page: Message[]) =>
            page.map((msg) =>
              msg.id === tempId
                ? { ...msg, sendStatus: "sending" as MessageSendStatus }
                : msg,
            ),
          ),
        };
      });

      return { tempId };
    },

    onSuccess: (serverMessage, { tempId }) => {
      // Replace the failed message with the real one from server
      queryClient.setQueryData(["messages", channelId], (old: any) => {
        if (!old) return { pages: [[serverMessage]], pageParams: [undefined] };

        // Check if server message already exists (added by WebSocket)
        const serverMessageExists = old.pages.some((page: Message[]) =>
          page.some((msg: Message) => msg.id === serverMessage.id),
        );

        return {
          ...old,
          pages: old.pages.map((page: Message[], pageIndex: number) => {
            if (pageIndex === 0) {
              const tempIndex = page.findIndex((msg) => msg.id === tempId);

              if (tempIndex !== -1) {
                if (serverMessageExists) {
                  // Server message already added by WebSocket, just remove temp
                  return page.filter((msg) => msg.id !== tempId);
                } else {
                  // Replace temp message with server message
                  const newPage = [...page];
                  newPage[tempIndex] = serverMessage;
                  return newPage;
                }
              }

              if (!serverMessageExists) {
                return [serverMessage, ...page];
              }
            }
            return page;
          }),
        };
      });

      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
    },

    onError: (_err, { tempId, retryData }) => {
      // Mark back as failed
      queryClient.setQueryData(["messages", channelId], (old: any) => {
        if (!old) return old;

        return {
          ...old,
          pages: old.pages.map((page: Message[]) =>
            page.map((msg) =>
              msg.id === tempId
                ? {
                    ...msg,
                    sendStatus: "failed" as MessageSendStatus,
                    _retryData: retryData,
                  }
                : msg,
            ),
          ),
        };
      });
    },
  });
}

/**
 * Hook to remove a failed message from the list
 */
export function useRemoveFailedMessage(channelId: string) {
  const queryClient = useQueryClient();

  return (tempId: string) => {
    queryClient.setQueryData(["messages", channelId], (old: any) => {
      if (!old) return old;

      return {
        ...old,
        pages: old.pages.map((page: Message[]) =>
          page.filter((msg) => msg.id !== tempId),
        ),
      };
    });
  };
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
