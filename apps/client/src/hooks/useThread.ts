import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";
import { api } from "@/services/api";
import type { ThreadResponse, CreateMessageDto } from "@/types/im";

// Thread panel state management
interface ReplyingTo {
  messageId: string;
  senderName: string;
}

interface ThreadState {
  isOpen: boolean;
  rootMessageId: string | null;
  replyingTo: ReplyingTo | null;
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
    set({ isOpen: true, rootMessageId: messageId, replyingTo: null }),
  closeThread: () =>
    set({ isOpen: false, rootMessageId: null, replyingTo: null }),
  setReplyingTo: (replyingTo: ReplyingTo | null) => set({ replyingTo }),
  clearReplyingTo: () => set({ replyingTo: null }),
}));

/**
 * Hook to fetch thread data with nested replies
 */
export function useThread(messageId: string | null) {
  return useQuery({
    queryKey: ["thread", messageId],
    queryFn: () => api.im.messages.getThread(messageId!),
    enabled: !!messageId,
    staleTime: 10000, // Reduced to allow faster updates
  });
}

/**
 * Hook to fetch sub-replies for expanding collapsed replies
 */
export function useSubReplies(messageId: string | null, enabled = false) {
  return useQuery({
    queryKey: ["subReplies", messageId],
    queryFn: () => api.im.messages.getSubReplies(messageId!),
    enabled: !!messageId && enabled,
    staleTime: 30000,
  });
}

/**
 * Hook to send a reply in a thread
 */
export function useSendThreadReply(rootMessageId: string) {
  const queryClient = useQueryClient();
  const { replyingTo, clearReplyingTo } = useThreadStore();

  return useMutation({
    mutationFn: async (data: Omit<CreateMessageDto, "parentId">) => {
      // Get the channel ID from the root message
      const threadData = queryClient.getQueryData<ThreadResponse>([
        "thread",
        rootMessageId,
      ]);
      if (!threadData) {
        throw new Error("Thread data not found");
      }

      const channelId = threadData.rootMessage.channelId;

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
      // Fetch fresh data and update cache directly
      const freshData = await api.im.messages.getThread(rootMessageId);
      console.log("[Thread] Fresh data fetched:", {
        totalReplyCount: freshData.totalReplyCount,
        repliesCount: freshData.replies.length,
        replies: freshData.replies.map((r) => ({
          id: r.id,
          content: r.content?.substring(0, 30),
          subReplyCount: r.subReplyCount,
        })),
      });
      queryClient.setQueryData(["thread", rootMessageId], freshData);
    },
  });
}

/**
 * Hook to get thread state and actions
 */
export function useThreadPanel() {
  const {
    isOpen,
    rootMessageId,
    replyingTo,
    openThread,
    closeThread,
    setReplyingTo,
    clearReplyingTo,
  } = useThreadStore();

  const { data: threadData, isLoading, error } = useThread(rootMessageId);

  return {
    isOpen,
    rootMessageId,
    replyingTo,
    threadData,
    isLoading,
    error,
    openThread,
    closeThread,
    setReplyingTo,
    clearReplyingTo,
  };
}
