import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useEffect, useCallback } from "react";
import { create } from "zustand";
import { api } from "@/services/api";
import type {
  ThreadResponse,
  SubRepliesResponse,
  CreateMessageDto,
} from "@/types/im";
import { useThreadScrollState } from "./useThreadScrollState";

// Thread panel state management (UI state only, scroll state moved to state machine)
interface ReplyingTo {
  messageId: string;
  senderName: string;
}

interface ThreadState {
  isOpen: boolean;
  rootMessageId: string | null;
  replyingTo: ReplyingTo | null;
  // Actions
  openThread: (messageId: string) => void;
  closeThread: () => void;
  setReplyingTo: (replyingTo: ReplyingTo | null) => void;
  clearReplyingTo: () => void;
}

export const useThreadStore = create<ThreadState>((set) => ({
  isOpen: false,
  rootMessageId: null,
  replyingTo: null,
  openThread: (messageId: string) =>
    set({
      isOpen: true,
      rootMessageId: messageId,
      replyingTo: null,
    }),
  closeThread: () =>
    set({
      isOpen: false,
      rootMessageId: null,
      replyingTo: null,
    }),
  setReplyingTo: (replyingTo: ReplyingTo | null) => set({ replyingTo }),
  clearReplyingTo: () => set({ replyingTo: null }),
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
export function useSubReplies(messageId: string | null, enabled = false) {
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
    staleTime: 30000,
  });
}

// Type for infinite query data structure
interface InfiniteThreadData {
  pages: ThreadResponse[];
  pageParams: (string | undefined)[];
}

/**
 * Hook to send a reply in a thread
 */
export function useSendThreadReply(rootMessageId: string) {
  const queryClient = useQueryClient();
  const { replyingTo, clearReplyingTo } = useThreadStore();

  return useMutation({
    mutationFn: async (data: Omit<CreateMessageDto, "parentId">) => {
      // Get the channel ID from the root message (from infinite query cache)
      const infiniteData = queryClient.getQueryData<InfiniteThreadData>([
        "thread",
        rootMessageId,
      ]);
      if (!infiniteData?.pages?.[0]) {
        throw new Error("Thread data not found");
      }

      const channelId = infiniteData.pages[0].rootMessage.channelId;

      // Determine parentId based on replyingTo state
      // If replyingTo is set, reply to that message (second-level reply)
      // Otherwise, reply to root message (first-level reply)
      const parentId = replyingTo?.messageId || rootMessageId;

      return api.im.messages.sendMessage(channelId, {
        ...data,
        parentId,
      });
    },
    onSuccess: async () => {
      // Clear replyingTo state first
      clearReplyingTo();
      // Invalidate and refetch the thread query to get fresh data
      await queryClient.invalidateQueries({
        queryKey: ["thread", rootMessageId],
      });
    },
  });
}

/**
 * Hook to get thread state and actions (with pagination support and state machine)
 */
export function useThreadPanel() {
  const queryClient = useQueryClient();

  // UI state from thread store
  const {
    isOpen,
    rootMessageId,
    replyingTo,
    openThread: baseOpenThread,
    closeThread: baseCloseThread,
    setReplyingTo,
    clearReplyingTo,
  } = useThreadStore();

  // Scroll state from state machine
  const scrollState = useThreadScrollState((s) => s.state);
  const scrollContext = useThreadScrollState((s) => s.context);
  const send = useThreadScrollState((s) => s.send);
  const setHasMorePages = useThreadScrollState((s) => s.setHasMorePages);

  // Query for thread data
  const {
    data,
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useThread(rootMessageId);

  // Sync hasNextPage with state machine
  useEffect(() => {
    setHasMorePages(hasNextPage ?? false);
  }, [hasNextPage, setHasMorePages]);

  // Reset state machine when thread opens/closes
  const openThread = useCallback(
    (messageId: string) => {
      send({ type: "RESET" });
      baseOpenThread(messageId);
    },
    [send, baseOpenThread],
  );

  const closeThread = useCallback(() => {
    send({ type: "RESET" });
    baseCloseThread();
  }, [send, baseCloseThread]);

  // Merge all pages into a single ThreadResponse-like structure
  const threadData = data?.pages?.[0]
    ? {
        rootMessage: data.pages[0].rootMessage,
        totalReplyCount: data.pages[0].totalReplyCount,
        // Merge replies from all pages
        replies: data.pages.flatMap((page) => page.replies),
        hasMore: data.pages[data.pages.length - 1]?.hasMore ?? false,
        nextCursor: data.pages[data.pages.length - 1]?.nextCursor ?? null,
      }
    : undefined;

  // Computed values from state machine
  const shouldShowNewMessageIndicator = scrollState === "hasNewMessages";
  const isJumpingToLatest = scrollState === "jumpingToLatest";
  const newMessageCount = scrollContext.newMessageCount;

  /**
   * Continue loading from current position and fetch new messages.
   * This preserves already loaded history and only fetches new data.
   * Returns a promise that resolves when all data is loaded.
   */
  const jumpToLatest = useCallback(async (): Promise<void> => {
    if (!rootMessageId) return;

    send({ type: "JUMP_TO_LATEST" });

    try {
      // First, invalidate to mark data as stale and trigger refetch
      // This will refetch the first page which includes new messages
      await queryClient.invalidateQueries({
        queryKey: ["thread", rootMessageId],
      });

      // Then load all remaining pages until no more
      let currentData = queryClient.getQueryData<InfiniteData<ThreadResponse>>([
        "thread",
        rootMessageId,
      ]);

      while (currentData?.pages?.[currentData.pages.length - 1]?.hasMore) {
        await fetchNextPage();
        currentData = queryClient.getQueryData<InfiniteData<ThreadResponse>>([
          "thread",
          rootMessageId,
        ]);
      }

      send({ type: "REFRESH_COMPLETE" });
    } catch {
      // On error, complete the refresh anyway
      send({ type: "REFRESH_COMPLETE" });
    }
  }, [rootMessageId, queryClient, fetchNextPage, send]);

  /**
   * Handle scroll position changes
   * This is called by the ThreadPanel component when scroll position changes
   */
  const handleScrollPositionChange = useCallback(
    async (atBottom: boolean) => {
      if (atBottom) {
        // Check current state before sending event
        const currentState = useThreadScrollState.getState().state;
        const currentContext = useThreadScrollState.getState().context;

        send({ type: "SCROLL_TO_BOTTOM" });

        // If there are new messages and no more pages to load, trigger refresh
        if (
          currentState === "hasNewMessages" &&
          !hasNextPage &&
          currentContext.newMessageCount > 0
        ) {
          // Trigger refresh to get new messages
          await jumpToLatest();
          return;
        }

        // Auto-load more if has more pages
        if (hasNextPage && !isFetchingNextPage) {
          send({ type: "LOAD_MORE" });
          await fetchNextPage();
          send({ type: "LOAD_COMPLETE" });
        }
      } else {
        send({ type: "SCROLL_AWAY" });
      }
    },
    [send, hasNextPage, isFetchingNextPage, fetchNextPage, jumpToLatest],
  );

  /**
   * Handle new message event from WebSocket
   * This should be called by useMessages when a new thread reply arrives
   */
  const onNewMessage = useCallback(() => {
    // Only handle if in a state that cares about new messages
    if (scrollState === "idle") {
      // In idle state, React Query will auto-refresh, no need to show indicator
      queryClient.invalidateQueries({
        queryKey: ["thread", rootMessageId],
        refetchType: "all",
      });
    } else {
      // In any other state, let the state machine handle it
      send({ type: "NEW_MESSAGE" });
    }
  }, [scrollState, queryClient, rootMessageId, send]);

  return {
    // UI state
    isOpen,
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
    setReplyingTo,
    clearReplyingTo,
  };
}
