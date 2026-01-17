import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  useQuery,
  type InfiniteData,
} from "@tanstack/react-query";
import { useEffect, useCallback } from "react";
import { create } from "zustand";
import { api } from "@/services/api";
import type {
  ThreadResponse,
  SubRepliesResponse,
  CreateMessageDto,
  Message,
} from "@/types/im";
import {
  useThreadScrollState,
  useThreadScrollSelectors,
} from "./useThreadScrollState";

// Thread panel state management (UI state only, scroll state moved to state machine)
interface ReplyingTo {
  messageId: string;
  senderName: string;
}

// Individual thread state
interface ThreadData {
  isOpen: boolean;
  rootMessageId: string | null;
  replyingTo: ReplyingTo | null;
}

// Dual-layer thread state (max 2 panels)
interface ThreadState {
  // Primary thread (first layer, opened from message list)
  primaryThread: ThreadData;
  // Secondary thread (second layer, opened from primary thread)
  secondaryThread: ThreadData;

  // Track unread sub-reply counts per reply message
  // Key: replyMessageId (first-level reply in primaryThread)
  // Value: number of unread sub-replies
  unreadSubReplyCounts: Record<string, number>;

  // Actions for primary thread
  openPrimaryThread: (messageId: string) => void;
  closePrimaryThread: () => void;
  setPrimaryReplyingTo: (replyingTo: ReplyingTo | null) => void;
  clearPrimaryReplyingTo: () => void;

  // Actions for secondary thread
  openSecondaryThread: (messageId: string) => void;
  closeSecondaryThread: () => void;
  setSecondaryReplyingTo: (replyingTo: ReplyingTo | null) => void;
  clearSecondaryReplyingTo: () => void;

  // Actions for unread sub-reply counts
  incrementUnreadSubReplyCount: (replyId: string) => void;
  clearUnreadSubReplyCount: (replyId: string) => void;
  getUnreadSubReplyCount: (replyId: string) => number;

  // Legacy API (for backward compatibility with MessageList)
  isOpen: boolean;
  rootMessageId: string | null;
  replyingTo: ReplyingTo | null;
  openThread: (messageId: string) => void;
  closeThread: () => void;
  setReplyingTo: (replyingTo: ReplyingTo | null) => void;
  clearReplyingTo: () => void;
}

const emptyThread: ThreadData = {
  isOpen: false,
  rootMessageId: null,
  replyingTo: null,
};

export const useThreadStore = create<ThreadState>((set, get) => ({
  primaryThread: { ...emptyThread },
  secondaryThread: { ...emptyThread },
  unreadSubReplyCounts: {},

  // Primary thread actions
  openPrimaryThread: (messageId: string) =>
    set({
      primaryThread: {
        isOpen: true,
        rootMessageId: messageId,
        replyingTo: null,
      },
      // Close secondary when opening new primary
      secondaryThread: { ...emptyThread },
    }),

  closePrimaryThread: () =>
    set({
      primaryThread: { ...emptyThread },
      // Also close secondary when closing primary
      secondaryThread: { ...emptyThread },
    }),

  setPrimaryReplyingTo: (replyingTo: ReplyingTo | null) =>
    set((state) => ({
      primaryThread: { ...state.primaryThread, replyingTo },
    })),

  clearPrimaryReplyingTo: () =>
    set((state) => ({
      primaryThread: { ...state.primaryThread, replyingTo: null },
    })),

  // Secondary thread actions
  openSecondaryThread: (messageId: string) =>
    set((state) => ({
      secondaryThread: {
        isOpen: true,
        rootMessageId: messageId,
        replyingTo: null,
      },
      // Clear unread count when opening this reply's thread
      unreadSubReplyCounts: {
        ...state.unreadSubReplyCounts,
        [messageId]: 0,
      },
    })),

  closeSecondaryThread: () =>
    set({
      secondaryThread: { ...emptyThread },
    }),

  setSecondaryReplyingTo: (replyingTo: ReplyingTo | null) =>
    set((state) => ({
      secondaryThread: { ...state.secondaryThread, replyingTo },
    })),

  clearSecondaryReplyingTo: () =>
    set((state) => ({
      secondaryThread: { ...state.secondaryThread, replyingTo: null },
    })),

  // Unread sub-reply count actions
  incrementUnreadSubReplyCount: (replyId: string) =>
    set((state) => ({
      unreadSubReplyCounts: {
        ...state.unreadSubReplyCounts,
        [replyId]: (state.unreadSubReplyCounts[replyId] || 0) + 1,
      },
    })),

  clearUnreadSubReplyCount: (replyId: string) =>
    set((state) => ({
      unreadSubReplyCounts: {
        ...state.unreadSubReplyCounts,
        [replyId]: 0,
      },
    })),

  getUnreadSubReplyCount: (replyId: string) => {
    return get().unreadSubReplyCounts[replyId] || 0;
  },

  // Legacy API (maps to primary thread for backward compatibility)
  get isOpen() {
    return get().primaryThread.isOpen;
  },
  get rootMessageId() {
    return get().primaryThread.rootMessageId;
  },
  get replyingTo() {
    return get().primaryThread.replyingTo;
  },
  openThread: (messageId: string) => get().openPrimaryThread(messageId),
  closeThread: () => get().closePrimaryThread(),
  setReplyingTo: (replyingTo: ReplyingTo | null) =>
    get().setPrimaryReplyingTo(replyingTo),
  clearReplyingTo: () => get().clearPrimaryReplyingTo(),
}));

/**
 * Hook to fetch thread data with nested replies (supports infinite scrolling)
 */
export function useThread(messageId: string | null) {
  return useInfiniteQuery({
    queryKey: ["thread", messageId],
    queryFn: ({ pageParam }) =>
      api.im.messages.getThread(messageId!, {
        limit: 20,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
    enabled: !!messageId,
    staleTime: 10000,
  });
}

/**
 * Hook to fetch sub-replies for expanding collapsed replies (supports infinite scrolling)
 */
export function useSubReplies(messageId: string | null, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["subReplies", messageId],
    queryFn: ({ pageParam }) =>
      api.im.messages.getSubReplies(messageId!, {
        limit: 20,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: SubRepliesResponse) =>
      lastPage.hasMore ? (lastPage.nextCursor ?? undefined) : undefined,
    enabled: !!messageId && enabled,
    staleTime: 10000,
  });
}

/**
 * Hook to fetch a single message details (for secondary thread root message)
 */
export function useMessage(messageId: string | null) {
  return useQuery({
    queryKey: ["message", messageId],
    queryFn: () => api.im.messages.getMessage(messageId!),
    enabled: !!messageId,
    staleTime: 30000,
  });
}

// Type for infinite query data structure
interface InfiniteThreadData {
  pages: ThreadResponse[];
  pageParams: (string | undefined)[];
}

// Thread level type
export type ThreadLevel = "primary" | "secondary";

/**
 * Hook to send a reply in a thread (supports both primary and secondary threads)
 */
export function useSendThreadReply(
  rootMessageId: string,
  level: ThreadLevel = "primary",
) {
  const queryClient = useQueryClient();
  const isPrimary = level === "primary";
  const replyingTo = useThreadStore((s) =>
    isPrimary ? s.primaryThread.replyingTo : s.secondaryThread.replyingTo,
  );
  const clearReplyingTo = useThreadStore((s) =>
    isPrimary ? s.clearPrimaryReplyingTo : s.clearSecondaryReplyingTo,
  );

  return useMutation({
    mutationFn: async (data: Omit<CreateMessageDto, "parentId">) => {
      let channelId: string;

      if (isPrimary) {
        // Primary: Get channelId from getThread cache
        const infiniteData = queryClient.getQueryData<InfiniteThreadData>([
          "thread",
          rootMessageId,
        ]);
        if (!infiniteData?.pages?.[0]) {
          throw new Error("Thread data not found");
        }
        channelId = infiniteData.pages[0].rootMessage.channelId;
      } else {
        // Secondary: Get channelId from getMessage cache
        const messageData = queryClient.getQueryData<Message>([
          "message",
          rootMessageId,
        ]);
        if (!messageData) {
          throw new Error("Message data not found");
        }
        channelId = messageData.channelId;
      }

      // Determine parentId based on replyingTo state
      // If replyingTo is set, reply to that message
      // Otherwise, reply to root message
      const parentId = replyingTo?.messageId || rootMessageId;

      return api.im.messages.sendMessage(channelId, {
        ...data,
        parentId,
      });
    },
    onSuccess: async () => {
      // Clear replyingTo state first
      clearReplyingTo();
      // Invalidate and refetch the appropriate query based on level
      if (isPrimary) {
        await queryClient.invalidateQueries({
          queryKey: ["thread", rootMessageId],
        });
      } else {
        await queryClient.invalidateQueries({
          queryKey: ["subReplies", rootMessageId],
        });
      }
    },
  });
}

/**
 * Hook to get thread state and actions for a specific level (with pagination support and state machine)
 *
 * Primary level: Uses getThread API to fetch root message + first-level replies
 * Secondary level: Uses getMessage + getSubReplies API to fetch a first-level reply + its sub-replies
 */
export function useThreadPanelForLevel(
  level: ThreadLevel,
  rootMessageId: string,
) {
  const queryClient = useQueryClient();
  const isPrimary = level === "primary";

  // UI state from thread store based on level
  const threadState = useThreadStore((s) =>
    isPrimary ? s.primaryThread : s.secondaryThread,
  );
  const replyingTo = threadState.replyingTo;

  const baseOpenThread = useThreadStore((s) =>
    isPrimary ? s.openPrimaryThread : s.openSecondaryThread,
  );
  const baseCloseThread = useThreadStore((s) =>
    isPrimary ? s.closePrimaryThread : s.closeSecondaryThread,
  );
  const setReplyingTo = useThreadStore((s) =>
    isPrimary ? s.setPrimaryReplyingTo : s.setSecondaryReplyingTo,
  );
  const clearReplyingTo = useThreadStore((s) =>
    isPrimary ? s.clearPrimaryReplyingTo : s.clearSecondaryReplyingTo,
  );

  // For opening nested thread (only available in primary level)
  const openSecondaryThread = useThreadStore((s) => s.openSecondaryThread);

  // Scroll state from state machine (keyed by messageId)
  const scrollSelectors = useThreadScrollSelectors(rootMessageId);
  const {
    state: scrollState,
    newMessageCount,
    shouldShowIndicator: shouldShowNewMessageIndicator,
    isJumpingToLatest,
    send,
    setHasMorePages,
    reset: resetScrollState,
  } = scrollSelectors;

  // Cleanup scroll state when thread closes
  const removeScrollState = useThreadScrollState((s) => s.remove);

  // === Primary level: Use getThread API ===
  const primaryQuery = useThread(isPrimary ? rootMessageId : null);

  // === Secondary level: Use getMessage + getSubReplies API ===
  const secondaryRootMessage = useMessage(!isPrimary ? rootMessageId : null);
  const secondaryReplies = useSubReplies(
    !isPrimary ? rootMessageId : null,
    !isPrimary,
  );

  // Combine data based on level
  const data = isPrimary ? primaryQuery.data : null;
  const isLoading = isPrimary
    ? primaryQuery.isLoading
    : secondaryRootMessage.isLoading || secondaryReplies.isLoading;
  const error = isPrimary
    ? primaryQuery.error
    : secondaryRootMessage.error || secondaryReplies.error;
  const hasNextPage = isPrimary
    ? primaryQuery.hasNextPage
    : secondaryReplies.hasNextPage;
  const isFetchingNextPage = isPrimary
    ? primaryQuery.isFetchingNextPage
    : secondaryReplies.isFetchingNextPage;
  const fetchNextPage = isPrimary
    ? primaryQuery.fetchNextPage
    : secondaryReplies.fetchNextPage;

  // Sync hasNextPage with state machine
  useEffect(() => {
    if (rootMessageId) {
      setHasMorePages(hasNextPage ?? false);
    }
  }, [hasNextPage, setHasMorePages, rootMessageId]);

  // Reset state machine when thread opens
  useEffect(() => {
    if (rootMessageId) {
      resetScrollState();
    }
  }, [rootMessageId, resetScrollState]);

  // Open thread handler
  const openThread = useCallback(
    (messageId: string) => {
      baseOpenThread(messageId);
    },
    [baseOpenThread],
  );

  // Close thread handler with cleanup
  const closeThread = useCallback(() => {
    if (rootMessageId) {
      removeScrollState(rootMessageId);
    }
    baseCloseThread();
  }, [baseCloseThread, removeScrollState, rootMessageId]);

  // Handler to open nested thread (only for primary level)
  const openNestedThread = useCallback(
    (messageId: string) => {
      if (isPrimary) {
        openSecondaryThread(messageId);
      }
    },
    [isPrimary, openSecondaryThread],
  );

  // Build threadData based on level
  // Primary: Use getThread response directly
  // Secondary: Build from getMessage + getSubReplies
  const threadData = isPrimary
    ? data?.pages?.[0]
      ? {
          rootMessage: data.pages[0].rootMessage,
          totalReplyCount: data.pages[0].totalReplyCount,
          // Deduplicate replies by id to prevent duplicate key errors
          replies: Array.from(
            new Map(
              data.pages.flatMap((page) => page.replies).map((r) => [r.id, r]),
            ).values(),
          ),
          hasMore: data.pages[data.pages.length - 1]?.hasMore ?? false,
          nextCursor: data.pages[data.pages.length - 1]?.nextCursor ?? null,
        }
      : undefined
    : secondaryRootMessage.data && secondaryReplies.data
      ? {
          rootMessage: secondaryRootMessage.data,
          totalReplyCount:
            secondaryReplies.data.pages?.[0]?.replies?.length ?? 0,
          // For secondary, replies are flat (no sub-replies structure needed)
          // Deduplicate replies by id to prevent duplicate key errors
          replies: Array.from(
            new Map(
              secondaryReplies.data.pages
                .flatMap((page) => page.replies)
                .map((reply) => [
                  reply.id,
                  {
                    ...reply,
                    subReplies: [],
                    subReplyCount: 0,
                  },
                ]),
            ).values(),
          ),
          hasMore:
            secondaryReplies.data.pages[secondaryReplies.data.pages.length - 1]
              ?.hasMore ?? false,
          nextCursor:
            secondaryReplies.data.pages[secondaryReplies.data.pages.length - 1]
              ?.nextCursor ?? null,
        }
      : undefined;

  // Query key for invalidation
  const queryKey = isPrimary
    ? ["thread", rootMessageId]
    : ["subReplies", rootMessageId];

  /**
   * Continue loading from current position and fetch new messages.
   */
  const jumpToLatest = useCallback(async (): Promise<void> => {
    if (!rootMessageId) return;

    send({ type: "JUMP_TO_LATEST" });

    try {
      await queryClient.invalidateQueries({ queryKey });

      if (isPrimary) {
        let currentData =
          queryClient.getQueryData<InfiniteData<ThreadResponse>>(queryKey);

        while (currentData?.pages?.[currentData.pages.length - 1]?.hasMore) {
          await fetchNextPage();
          currentData =
            queryClient.getQueryData<InfiniteData<ThreadResponse>>(queryKey);
        }
      } else {
        let currentData =
          queryClient.getQueryData<InfiniteData<SubRepliesResponse>>(queryKey);

        while (currentData?.pages?.[currentData.pages.length - 1]?.hasMore) {
          await fetchNextPage();
          currentData =
            queryClient.getQueryData<InfiniteData<SubRepliesResponse>>(
              queryKey,
            );
        }
      }

      send({ type: "REFRESH_COMPLETE" });
    } catch {
      send({ type: "REFRESH_COMPLETE" });
    }
  }, [rootMessageId, queryClient, fetchNextPage, send, queryKey, isPrimary]);

  /**
   * Handle scroll position changes
   */
  const handleScrollPositionChange = useCallback(
    async (atBottom: boolean) => {
      if (!rootMessageId) return;

      if (atBottom) {
        const currentThreadState = useThreadScrollState
          .getState()
          .getThreadState(rootMessageId);

        send({ type: "SCROLL_TO_BOTTOM" });

        if (
          currentThreadState.state === "hasNewMessages" &&
          !hasNextPage &&
          currentThreadState.context.newMessageCount > 0
        ) {
          await jumpToLatest();
          return;
        }

        if (hasNextPage && !isFetchingNextPage) {
          send({ type: "LOAD_MORE" });
          await fetchNextPage();
          send({ type: "LOAD_COMPLETE" });
        }
      } else {
        send({ type: "SCROLL_AWAY" });
      }
    },
    [
      rootMessageId,
      send,
      hasNextPage,
      isFetchingNextPage,
      fetchNextPage,
      jumpToLatest,
    ],
  );

  /**
   * Handle new message event from WebSocket
   */
  const onNewMessage = useCallback(() => {
    if (scrollState === "idle") {
      queryClient.invalidateQueries({
        queryKey,
        refetchType: "all",
      });
    } else {
      send({ type: "NEW_MESSAGE" });
    }
  }, [scrollState, queryClient, queryKey, send]);

  return {
    // Level info
    level,
    canOpenNestedThread: isPrimary,

    // UI state
    rootMessageId,
    replyingTo,
    threadData,
    isLoading,
    error,

    // Pagination controls
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,

    // State machine state
    scrollState,
    newMessageCount,
    shouldShowNewMessageIndicator,
    isJumpingToLatest,

    // State machine actions
    handleScrollPositionChange,
    jumpToLatest,
    onNewMessage,

    // UI actions
    openThread,
    closeThread,
    openNestedThread,
    setReplyingTo,
    clearReplyingTo,
  };
}

/**
 * Legacy hook for backward compatibility (uses primary thread)
 * @deprecated Use useThreadPanelForLevel instead
 */
export function useThreadPanel() {
  const primaryThread = useThreadStore((s) => s.primaryThread);
  const { isOpen, rootMessageId } = primaryThread;

  // Use the new hook if thread is open
  const panelState = useThreadPanelForLevel("primary", rootMessageId || "");

  // Return compatible interface
  return {
    ...panelState,
    isOpen,
    rootMessageId,
    // Legacy openThread that accepts messageId
    openThread: panelState.openThread,
  };
}
