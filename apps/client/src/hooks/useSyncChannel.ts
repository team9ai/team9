import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import imApi from "@/services/api/im";
import type { Message, SyncMessageItem } from "@/types/im";

/**
 * Convert SyncMessageItem to Message format for cache compatibility
 */
function syncItemToMessage(item: SyncMessageItem): Message {
  return {
    id: item.id,
    channelId: item.channelId,
    senderId: item.senderId || "",
    parentId: item.parentId || undefined,
    rootId: item.rootId || undefined,
    content: item.content || "",
    type: item.type as Message["type"],
    isPinned: item.isPinned,
    isEdited: item.isEdited,
    isDeleted: false,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    sender: item.sender
      ? {
          id: item.sender.id,
          email: "",
          username: item.sender.username,
          displayName: item.sender.displayName || undefined,
          avatarUrl: item.sender.avatarUrl || undefined,
          status: "offline",
          isActive: true,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        }
      : undefined,
    reactions: [],
    replyCount: 0,
  };
}

/**
 * Hook to sync messages when opening a channel
 * This is called once when a channel is opened to fetch any missed messages
 * since the user's last sync position (lazy loading approach)
 */
export function useSyncChannel(channelId: string | undefined) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["sync", channelId],
    queryFn: () => imApi.sync.syncChannel(channelId!),
    enabled: !!channelId,
    // Only sync once per channel open, not on every re-render
    staleTime: 30000, // Consider fresh for 30 seconds
    gcTime: 60000, // Keep in cache for 1 minute
    // Don't refetch on window focus - sync should be explicit
    refetchOnWindowFocus: false,
    refetchOnMount: true,
  });

  // Merge synced messages into the messages cache
  useEffect(() => {
    if (!query.data || !channelId) return;

    const { messages: syncedMessages } = query.data;

    if (syncedMessages.length === 0) return;

    // Convert synced messages to Message format, filtering out thread replies
    // (messages with parentId) since they belong in thread caches, not the main list
    const convertedMessages = syncedMessages
      .filter((item) => !item.parentId)
      .map(syncItemToMessage);

    if (convertedMessages.length === 0) return;

    // Merge into all messages query caches for this channel (handles both old and new key formats)
    queryClient.setQueriesData(
      { queryKey: ["messages", channelId] },
      (old: any) => {
        if (!old) {
          return {
            pages: [
              { messages: convertedMessages, hasOlder: false, hasNewer: false },
            ],
            pageParams: [undefined],
          };
        }

        // Get all existing message IDs for deduplication (supports both page formats)
        const existingIds = new Set<string>();
        old.pages.forEach((page: any) => {
          const msgs: Message[] = Array.isArray(page) ? page : page.messages;
          msgs.forEach((msg) => existingIds.add(msg.id));
        });

        const newMessages = convertedMessages.filter(
          (msg) => !existingIds.has(msg.id),
        );

        if (newMessages.length === 0) return old;

        // Prepend new messages to the first page (format-agnostic)
        const firstPage = old.pages[0];
        const firstPageMsgs: Message[] = Array.isArray(firstPage)
          ? firstPage
          : firstPage.messages;
        const updatedFirstPage = Array.isArray(firstPage)
          ? [...newMessages, ...firstPageMsgs]
          : { ...firstPage, messages: [...newMessages, ...firstPageMsgs] };

        return {
          ...old,
          pages: [updatedFirstPage, ...old.pages.slice(1)],
        };
      },
    );
  }, [query.data, channelId, queryClient]);

  return { ...query, hasMoreUnsynced: query.data?.hasMore ?? false };
}
