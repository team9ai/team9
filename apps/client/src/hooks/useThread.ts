import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { create } from "zustand";
import { api } from "@/services/api";
import type {
  ThreadResponse,
  SubRepliesResponse,
  CreateMessageDto,
} from "@/types/im";

// Thread panel state management
interface ReplyingTo {
  messageId: string;
  senderName: string;
}

interface ThreadState {
  isOpen: boolean;
  rootMessageId: string | null;
  replyingTo: ReplyingTo | null;
  // New message indicator state
  newMessageCount: number;
  isAtBottom: boolean;
  // Actions
  openThread: (messageId: string) => void;
  closeThread: () => void;
  setReplyingTo: (replyingTo: ReplyingTo | null) => void;
  clearReplyingTo: () => void;
  // New message indicator actions
  incrementNewMessageCount: () => void;
  clearNewMessageCount: () => void;
  setIsAtBottom: (isAtBottom: boolean) => void;
}

export const useThreadStore = create<ThreadState>((set) => ({
  isOpen: false,
  rootMessageId: null,
  replyingTo: null,
  newMessageCount: 0,
  isAtBottom: true,
  openThread: (messageId: string) =>
    set({
      isOpen: true,
      rootMessageId: messageId,
      replyingTo: null,
      newMessageCount: 0,
      isAtBottom: true,
    }),
  closeThread: () =>
    set({
      isOpen: false,
      rootMessageId: null,
      replyingTo: null,
      newMessageCount: 0,
      isAtBottom: true,
    }),
  setReplyingTo: (replyingTo: ReplyingTo | null) => set({ replyingTo }),
  clearReplyingTo: () => set({ replyingTo: null }),
  incrementNewMessageCount: () =>
    set((state) => ({ newMessageCount: state.newMessageCount + 1 })),
  clearNewMessageCount: () => set({ newMessageCount: 0 }),
  setIsAtBottom: (isAtBottom: boolean) => set({ isAtBottom }),
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
 * Hook to get thread state and actions (with pagination support)
 */
export function useThreadPanel() {
  const queryClient = useQueryClient();
  const {
    isOpen,
    rootMessageId,
    replyingTo,
    newMessageCount,
    isAtBottom,
    openThread,
    closeThread,
    setReplyingTo,
    clearReplyingTo,
    incrementNewMessageCount,
    clearNewMessageCount,
    setIsAtBottom,
  } = useThreadStore();

  const {
    data,
    isLoading,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useThread(rootMessageId);

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

  // Determine if we should show new message indicator
  // Show when: user is not at bottom OR there are unloaded pages (hasNextPage)
  const shouldShowNewMessageIndicator =
    newMessageCount > 0 && (!isAtBottom || hasNextPage);

  /**
   * Load all remaining pages and then invalidate to get latest messages.
   * This is used when user clicks the "new messages" indicator.
   * Returns a promise that resolves when all data is loaded.
   */
  const loadAllPagesAndRefresh = async (): Promise<void> => {
    if (!rootMessageId) return;

    // First, load all remaining pages
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

    // After loading all existing pages, invalidate and refetch to get new messages
    // Reset the query completely to fetch fresh data from the beginning
    await queryClient.resetQueries({
      queryKey: ["thread", rootMessageId],
    });

    // After reset, we need to load all pages again to show all messages
    // But this time we'll get the updated data including new messages
    currentData = queryClient.getQueryData<InfiniteData<ThreadResponse>>([
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
  };

  return {
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
    loadAllPagesAndRefresh,
    // New message indicator
    newMessageCount,
    isAtBottom,
    shouldShowNewMessageIndicator,
    incrementNewMessageCount,
    clearNewMessageCount,
    setIsAtBottom,
    // Actions
    openThread,
    closeThread,
    setReplyingTo,
    clearReplyingTo,
  };
}
