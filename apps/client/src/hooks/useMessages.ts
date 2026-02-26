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
import type {
  StreamingStartEvent,
  StreamingContentEvent,
  StreamingThinkingContentEvent,
  StreamingEndEvent,
  StreamingAbortEvent,
  ReactionAddedEvent,
  ReactionRemovedEvent,
} from "@/types/ws-events";
import { useSelectedWorkspaceId } from "@/stores";
import { useAppStore } from "@/stores/useAppStore";
import { useStreamingStore } from "@/stores/useStreamingStore";
import { isTemporaryId } from "@/lib/utils";
import { useThreadStore } from "./useThread";
import { useThreadScrollState } from "./useThreadScrollState";

// --- Temp message coordination ---
// Coordinates between HTTP onSuccess and WebSocket handleNewMessage
// to prevent race conditions (duplicate messages, temp message leaks).
interface PendingTemp {
  channelId: string;
  senderId: string;
  content: string;
}

const pendingTempMessages = new Map<string, PendingTemp>();
const resolvedServerIds = new Set<string>();

function findPendingTempId(
  channelId: string,
  senderId: string,
  content: string,
): string | undefined {
  for (const [tempId, p] of pendingTempMessages) {
    if (
      p.channelId === channelId &&
      p.senderId === senderId &&
      p.content === content
    ) {
      return tempId;
    }
  }
  return undefined;
}

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
      for (let i = lastPage.length - 1; i >= 0; i--) {
        if (!isTemporaryId(lastPage[i].id)) {
          return lastPage[i].id;
        }
      }
      return undefined;
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

        // Auto-open thread panel for bot thread replies
        if (message.sender?.userType === "bot") {
          autoOpenBotThread(rootId);
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

        // Use coordination map for precise tempId lookup instead of content-scanning cache
        const matchedTempId = message.senderId
          ? findPendingTempId(channelId, message.senderId, message.content)
          : undefined;

        if (exists) {
          // Server message exists - clean up any lingering temp duplicate
          if (!matchedTempId) return old;
          pendingTempMessages.delete(matchedTempId);
          return {
            ...old,
            pages: old.pages.map((page: Message[]) =>
              page.filter((msg) => msg.id !== matchedTempId),
            ),
          };
        }

        // Replace matching temp message in-place (smooth transition, no flicker)
        if (matchedTempId) {
          // Record that WS handled this server message so onSuccess can skip
          resolvedServerIds.add(message.id);
          pendingTempMessages.delete(matchedTempId);
          setTimeout(() => resolvedServerIds.delete(message.id), 30000);
          return {
            ...old,
            pages: old.pages.map((page: Message[]) =>
              page.map((msg) => (msg.id === matchedTempId ? message : msg)),
            ),
          };
        }

        // No matching temp found - new message from someone else, prepend
        return {
          ...old,
          pages: old.pages[0]
            ? [[message, ...old.pages[0]], ...old.pages.slice(1)]
            : [[message]],
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

    // Auto-open thread panel when bot replies to current user's message
    const autoOpenBotThread = (rootId: string) => {
      const threadState = useThreadStore.getState();
      // Already viewing this thread — no action needed
      if (threadState.primaryThread.rootMessageId === rootId) return;

      const currentUserId = useAppStore.getState().user?.id;
      if (!currentUserId) return;

      // Look up parent message in cache to verify current user triggered the bot
      const messagesData = queryClient.getQueryData([
        "messages",
        channelId,
      ]) as any;
      if (!messagesData) return;

      const parentMsg = messagesData.pages
        .flat()
        .find((m: any) => m.id === rootId);
      if (parentMsg?.senderId === currentUserId) {
        threadState.openPrimaryThread(rootId);
      }
    };

    // Streaming event handlers
    const handleStreamingStart = (event: StreamingStartEvent) => {
      if (event.channelId !== channelId) return;
      useStreamingStore.getState().startStream(event);

      // Auto-open thread panel when bot starts streaming in a thread
      if (event.parentId) {
        autoOpenBotThread(event.parentId);
      }
    };

    // Auto-create stream if a delta arrives before streaming_start (race condition).
    const ensureStream = (event: {
      streamId: string;
      channelId: string;
      senderId: string;
    }) => {
      if (!useStreamingStore.getState().streams.has(event.streamId)) {
        useStreamingStore.getState().startStream({
          streamId: event.streamId,
          channelId: event.channelId,
          senderId: event.senderId,
          startedAt: Date.now(),
        });
      }
    };

    const handleStreamingDelta = (event: StreamingContentEvent) => {
      if (event.channelId !== channelId) return;
      ensureStream(event);
      useStreamingStore
        .getState()
        .setStreamContent(event.streamId, event.content);
    };

    const handleStreamingThinkingDelta = (
      event: StreamingThinkingContentEvent,
    ) => {
      if (event.channelId !== channelId) return;
      ensureStream(event);
      useStreamingStore
        .getState()
        .setThinkingContent(event.streamId, event.content);
    };

    const handleStreamingEnd = (event: StreamingEndEvent) => {
      if (event.channelId !== channelId) return;
      useStreamingStore.getState().endStream(event.streamId);

      // Proactively insert the final message into cache as a safety net,
      // in case the subsequent new_message broadcast is lost.
      if (event.message) {
        const msg = event.message as Message;
        if (!msg.parentId) {
          // Main channel message - insert into messages cache
          queryClient.setQueryData(["messages", channelId], (old: any) => {
            if (!old) return { pages: [[msg]], pageParams: [undefined] };
            const exists = old.pages.some((page: Message[]) =>
              page.some((m) => m.id === msg.id),
            );
            if (exists) return old;
            return {
              ...old,
              pages: [[msg, ...old.pages[0]], ...old.pages.slice(1)],
            };
          });
        } else {
          // Thread reply - invalidate thread query so it's fresh when viewed
          const rootId = msg.rootId || msg.parentId;
          queryClient.invalidateQueries({
            queryKey: ["thread", rootId],
            refetchType: "all",
          });
        }
      }
    };

    const handleStreamingAbort = (event: StreamingAbortEvent) => {
      if (event.channelId !== channelId) return;
      useStreamingStore.getState().abortStream(event.streamId);
    };

    const handleReactionAdded = (event: ReactionAddedEvent) => {
      // Update main messages cache
      queryClient.setQueryData(["messages", channelId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page: Message[]) =>
            page.map((msg) => {
              if (msg.id !== event.messageId) return msg;
              const existing = msg.reactions || [];
              // Prevent duplicate
              if (
                existing.some(
                  (r) => r.userId === event.userId && r.emoji === event.emoji,
                )
              )
                return msg;
              return {
                ...msg,
                reactions: [
                  ...existing,
                  {
                    id: `${event.userId}-${event.emoji}`,
                    messageId: event.messageId,
                    userId: event.userId,
                    emoji: event.emoji,
                    createdAt: new Date().toISOString(),
                  },
                ],
              };
            }),
          ),
        };
      });

      // Update open thread caches
      const newReaction = {
        id: `${event.userId}-${event.emoji}`,
        messageId: event.messageId,
        userId: event.userId,
        emoji: event.emoji,
        createdAt: new Date().toISOString(),
      };
      const threadState = useThreadStore.getState();
      if (
        threadState.primaryThread.isOpen &&
        threadState.primaryThread.rootMessageId
      ) {
        const threadKey = ["thread", threadState.primaryThread.rootMessageId];
        queryClient.setQueryData(threadKey, (old: any) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page: any) => ({
              ...page,
              replies: page.replies.map((reply: any) => {
                if (reply.id !== event.messageId) return reply;
                const existing = reply.reactions || [];
                if (
                  existing.some(
                    (r: any) =>
                      r.userId === event.userId && r.emoji === event.emoji,
                  )
                )
                  return reply;
                return { ...reply, reactions: [...existing, newReaction] };
              }),
            })),
          };
        });
      }
      if (
        threadState.secondaryThread.isOpen &&
        threadState.secondaryThread.rootMessageId
      ) {
        const subKey = [
          "subReplies",
          threadState.secondaryThread.rootMessageId,
        ];
        queryClient.setQueryData(subKey, (old: any) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page: any) => ({
              ...page,
              replies: page.replies.map((reply: any) => {
                if (reply.id !== event.messageId) return reply;
                const existing = reply.reactions || [];
                if (
                  existing.some(
                    (r: any) =>
                      r.userId === event.userId && r.emoji === event.emoji,
                  )
                )
                  return reply;
                return { ...reply, reactions: [...existing, newReaction] };
              }),
            })),
          };
        });
      }
    };

    const handleReactionRemoved = (event: ReactionRemovedEvent) => {
      // Update main messages cache
      queryClient.setQueryData(["messages", channelId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page: Message[]) =>
            page.map((msg) => {
              if (msg.id !== event.messageId) return msg;
              return {
                ...msg,
                reactions: (msg.reactions || []).filter(
                  (r: any) =>
                    !(r.userId === event.userId && r.emoji === event.emoji),
                ),
              };
            }),
          ),
        };
      });

      // Update open thread caches
      const filterReaction = (reactions: any[]) =>
        reactions.filter(
          (r: any) => !(r.userId === event.userId && r.emoji === event.emoji),
        );
      const threadState = useThreadStore.getState();
      if (
        threadState.primaryThread.isOpen &&
        threadState.primaryThread.rootMessageId
      ) {
        const threadKey = ["thread", threadState.primaryThread.rootMessageId];
        queryClient.setQueryData(threadKey, (old: any) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page: any) => ({
              ...page,
              replies: page.replies.map((reply: any) => {
                if (reply.id !== event.messageId) return reply;
                return {
                  ...reply,
                  reactions: filterReaction(reply.reactions || []),
                };
              }),
            })),
          };
        });
      }
      if (
        threadState.secondaryThread.isOpen &&
        threadState.secondaryThread.rootMessageId
      ) {
        const subKey = [
          "subReplies",
          threadState.secondaryThread.rootMessageId,
        ];
        queryClient.setQueryData(subKey, (old: any) => {
          if (!old) return old;
          return {
            ...old,
            pages: old.pages.map((page: any) => ({
              ...page,
              replies: page.replies.map((reply: any) => {
                if (reply.id !== event.messageId) return reply;
                return {
                  ...reply,
                  reactions: filterReaction(reply.reactions || []),
                };
              }),
            })),
          };
        });
      }
    };

    wsService.onNewMessage(handleNewMessage);
    wsService.onMessageUpdated(handleMessageUpdated);
    wsService.onMessageDeleted(handleMessageDeleted);
    wsService.onReactionAdded(handleReactionAdded);
    wsService.onReactionRemoved(handleReactionRemoved);
    wsService.onStreamingStart(handleStreamingStart);
    wsService.onStreamingContent(handleStreamingDelta);
    wsService.onStreamingThinkingContent(handleStreamingThinkingDelta);
    wsService.onStreamingEnd(handleStreamingEnd);
    wsService.onStreamingAbort(handleStreamingAbort);

    return () => {
      wsService.off("new_message", handleNewMessage);
      wsService.off("message_updated", handleMessageUpdated);
      wsService.off("message_deleted", handleMessageDeleted);
      wsService.off("reaction_added", handleReactionAdded);
      wsService.off("reaction_removed", handleReactionRemoved);
      wsService.off("streaming_start", handleStreamingStart);
      wsService.off("streaming_content", handleStreamingDelta);
      wsService.off("streaming_thinking_content", handleStreamingThinkingDelta);
      wsService.off("streaming_end", handleStreamingEnd);
      wsService.off("streaming_abort", handleStreamingAbort);
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

      // Get current user from app store (static import eliminates async gap)
      const currentUser = useAppStore.getState().user;

      // Generate a temporary ID for the optimistic message
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

      // Register for WS coordination before any async gap
      pendingTempMessages.set(tempId, {
        channelId,
        senderId: currentUser?.id || "",
        content: newMessageData.content,
      });
      setTimeout(() => pendingTempMessages.delete(tempId), 60000);

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
      // Clean up pending tracking
      if (context?.tempId) {
        pendingTempMessages.delete(context.tempId);
      }

      // If WebSocket already handled this message, just ensure no lingering temp
      if (resolvedServerIds.has(serverMessage.id)) {
        resolvedServerIds.delete(serverMessage.id);
        queryClient.setQueryData(["messages", channelId], (old: any) => {
          if (!old) return old;
          const hasTempMsg = old.pages.some((page: Message[]) =>
            page.some((msg) => msg.id === context?.tempId),
          );
          if (!hasTempMsg) return old;
          return {
            ...old,
            pages: old.pages.map((page: Message[]) =>
              page.filter((msg) => msg.id !== context?.tempId),
            ),
          };
        });
        queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
        return;
      }

      // Normal path: replace the optimistic message with the real one from server
      queryClient.setQueryData(["messages", channelId], (old: any) => {
        if (!old) return { pages: [[serverMessage]], pageParams: [undefined] };

        const serverMessageExists = old.pages.some((page: Message[]) =>
          page.some((msg: Message) => msg.id === serverMessage.id),
        );

        let tempFound = false;
        const updatedPages = old.pages.map((page: Message[]) => {
          const tempIndex = page.findIndex((msg) => msg.id === context?.tempId);

          if (tempIndex !== -1) {
            tempFound = true;
            if (serverMessageExists) {
              return page.filter((msg) => msg.id !== context?.tempId);
            } else {
              const newPage = [...page];
              newPage[tempIndex] = {
                ...serverMessage,
                sendStatus: undefined,
                _retryData: undefined,
              };
              return newPage;
            }
          }
          return page;
        });

        if (!tempFound && !serverMessageExists) {
          updatedPages[0] = [serverMessage, ...updatedPages[0]];
        }

        return { ...old, pages: updatedPages };
      });

      // Invalidate channels to update unread counts
      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
    },

    onError: (_err, variables, context) => {
      if (context?.tempId) {
        // Clean up pending tracking
        pendingTempMessages.delete(context.tempId);
      }
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

    onMutate: async ({ tempId, retryData }) => {
      // Re-register for WS coordination
      const currentUser = useAppStore.getState().user;
      pendingTempMessages.set(tempId, {
        channelId,
        senderId: currentUser?.id || "",
        content: retryData.content,
      });
      setTimeout(() => pendingTempMessages.delete(tempId), 60000);

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
      // Clean up pending tracking
      pendingTempMessages.delete(tempId);

      // If WebSocket already handled this message, just ensure no lingering temp
      if (resolvedServerIds.has(serverMessage.id)) {
        resolvedServerIds.delete(serverMessage.id);
        queryClient.setQueryData(["messages", channelId], (old: any) => {
          if (!old) return old;
          const hasTempMsg = old.pages.some((page: Message[]) =>
            page.some((msg) => msg.id === tempId),
          );
          if (!hasTempMsg) return old;
          return {
            ...old,
            pages: old.pages.map((page: Message[]) =>
              page.filter((msg) => msg.id !== tempId),
            ),
          };
        });
        queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
        return;
      }

      // Normal path: replace the failed message with the real one from server
      queryClient.setQueryData(["messages", channelId], (old: any) => {
        if (!old) return { pages: [[serverMessage]], pageParams: [undefined] };

        const serverMessageExists = old.pages.some((page: Message[]) =>
          page.some((msg: Message) => msg.id === serverMessage.id),
        );

        let tempFound = false;
        const updatedPages = old.pages.map((page: Message[]) => {
          const tempIndex = page.findIndex((msg) => msg.id === tempId);

          if (tempIndex !== -1) {
            tempFound = true;
            if (serverMessageExists) {
              return page.filter((msg) => msg.id !== tempId);
            } else {
              const newPage = [...page];
              newPage[tempIndex] = {
                ...serverMessage,
                sendStatus: undefined,
                _retryData: undefined,
              };
              return newPage;
            }
          }
          return page;
        });

        if (!tempFound && !serverMessageExists) {
          updatedPages[0] = [serverMessage, ...updatedPages[0]];
        }

        return { ...old, pages: updatedPages };
      });

      queryClient.invalidateQueries({ queryKey: ["channels", workspaceId] });
    },

    onError: (_err, { tempId, retryData }) => {
      // Clean up pending tracking
      pendingTempMessages.delete(tempId);
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
 * Hook to add a reaction with optimistic update (via WebSocket for real-time broadcast)
 */
export function useAddReaction(channelId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      messageId,
      emoji,
    }: {
      messageId: string;
      emoji: string;
    }) => {
      wsService.addReaction({ messageId, emoji });
    },

    onMutate: async ({ messageId, emoji }) => {
      const currentUser = useAppStore.getState().user;
      if (!channelId || !currentUser) return;
      await queryClient.cancelQueries({ queryKey: ["messages", channelId] });

      queryClient.setQueryData(["messages", channelId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page: Message[]) =>
            page.map((msg) => {
              if (msg.id !== messageId) return msg;
              const existing = msg.reactions || [];
              if (
                existing.some(
                  (r) => r.userId === currentUser.id && r.emoji === emoji,
                )
              )
                return msg;
              return {
                ...msg,
                reactions: [
                  ...existing,
                  {
                    id: `optimistic-${currentUser.id}-${emoji}`,
                    messageId,
                    userId: currentUser.id,
                    emoji,
                    createdAt: new Date().toISOString(),
                  },
                ],
              };
            }),
          ),
        };
      });
    },
  });
}

/**
 * Hook to remove a reaction with optimistic update (via WebSocket for real-time broadcast)
 */
export function useRemoveReaction(channelId?: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      messageId,
      emoji,
    }: {
      messageId: string;
      emoji: string;
    }) => {
      wsService.removeReaction({ messageId, emoji });
    },

    onMutate: async ({ messageId, emoji }) => {
      const currentUser = useAppStore.getState().user;
      if (!channelId || !currentUser) return;
      await queryClient.cancelQueries({ queryKey: ["messages", channelId] });

      queryClient.setQueryData(["messages", channelId], (old: any) => {
        if (!old) return old;
        return {
          ...old,
          pages: old.pages.map((page: Message[]) =>
            page.map((msg) => {
              if (msg.id !== messageId) return msg;
              return {
                ...msg,
                reactions: (msg.reactions || []).filter(
                  (r: any) =>
                    !(r.userId === currentUser.id && r.emoji === emoji),
                ),
              };
            }),
          ),
        };
      });
    },
  });
}
