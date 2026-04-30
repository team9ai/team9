import {
  useQuery,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useEffect } from "react";
import imApi from "@/services/api/im";
import type {
  Message,
  PaginatedMessagesResponse,
  SubRepliesResponse,
  SyncMessageItem,
  ThreadResponse,
} from "@/types/im";

type MessagesQueryData = InfiniteData<PaginatedMessagesResponse>;
type ThreadQueryData = InfiniteData<ThreadResponse>;
type SubRepliesQueryData = InfiniteData<SubRepliesResponse>;

/**
 * Convert SyncMessageItem to Message format for cache compatibility
 */
export function syncItemToMessage(item: SyncMessageItem): Message {
  return {
    id: item.id,
    channelId: item.channelId,
    senderId: item.senderId || "",
    parentId: item.parentId || undefined,
    rootId: item.rootId || undefined,
    content: item.content || "",
    contentAst: item.contentAst ?? null,
    type: item.type as Message["type"],
    metadata: item.metadata ?? undefined,
    isPinned: item.isPinned,
    isEdited: item.isEdited,
    isDeleted: item.isDeleted ?? false,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    sender: item.sender
      ? {
          id: item.sender.id,
          email: "",
          username: item.sender.username,
          displayName: item.sender.displayName || undefined,
          avatarUrl: item.sender.avatarUrl || undefined,
          agentType: item.sender.agentType ?? undefined,
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
 * Result of merging synced messages, partitioned by target cache
 */
export interface SyncMergeResult {
  // Main messages to update in ["messages", channelId]
  mainUpdates: {
    newMessages: Message[];
    editedMessages: Map<string, Message>; // id -> updated message
    deletedIds: Set<string>;
  };
  // First-level replies grouped by rootId for ["thread", rootId]
  threadUpdates: Map<
    string,
    { new: Message[]; edited: Map<string, Message>; deletedIds: Set<string> }
  >;
  // Sub-replies grouped by parentReplyId for ["subReplies", parentReplyId]
  subReplyUpdates: Map<
    string,
    { new: Message[]; edited: Map<string, Message>; deletedIds: Set<string> }
  >;
}

/**
 * Helper to get or create an update bucket in a Map
 */
function getOrCreateBucket(
  map: Map<
    string,
    { new: Message[]; edited: Map<string, Message>; deletedIds: Set<string> }
  >,
  key: string,
) {
  let bucket = map.get(key);
  if (!bucket) {
    bucket = { new: [], edited: new Map(), deletedIds: new Set() };
    map.set(key, bucket);
  }
  return bucket;
}

/**
 * Partition synced messages into main/thread/sub-reply buckets with
 * new/edited/deleted classification for each.
 *
 * Classification rules:
 * - Main message:      !parentId
 * - First-level reply: parentId && parentId === rootId
 * - Sub-reply:         parentId && rootId && parentId !== rootId
 *
 * Within each bucket:
 * - isDeleted  -> deletedIds
 * - isEdited   -> editedMessages
 * - otherwise  -> newMessages
 */
export function mergeSyncedMessages(
  syncedMessages: SyncMessageItem[],
): SyncMergeResult {
  const result: SyncMergeResult = {
    mainUpdates: {
      newMessages: [],
      editedMessages: new Map(),
      deletedIds: new Set(),
    },
    threadUpdates: new Map(),
    subReplyUpdates: new Map(),
  };

  for (const item of syncedMessages) {
    const msg = syncItemToMessage(item);
    const { parentId, rootId } = item;

    if (!parentId) {
      // Main message (no parentId)
      if (item.isDeleted) {
        result.mainUpdates.deletedIds.add(msg.id);
      } else if (item.isEdited) {
        result.mainUpdates.editedMessages.set(msg.id, msg);
      } else {
        result.mainUpdates.newMessages.push(msg);
      }
    } else if (parentId === rootId) {
      // First-level reply: parentId equals rootId
      const bucket = getOrCreateBucket(result.threadUpdates, parentId);
      if (item.isDeleted) {
        bucket.deletedIds.add(msg.id);
      } else if (item.isEdited) {
        bucket.edited.set(msg.id, msg);
      } else {
        bucket.new.push(msg);
      }
    } else if (rootId) {
      // Sub-reply: parentId differs from rootId, key by parentId
      const bucket = getOrCreateBucket(result.subReplyUpdates, parentId);
      if (item.isDeleted) {
        bucket.deletedIds.add(msg.id);
      } else if (item.isEdited) {
        bucket.edited.set(msg.id, msg);
      } else {
        bucket.new.push(msg);
      }
    }
  }

  return result;
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

  // Merge synced messages into the appropriate caches
  useEffect(() => {
    if (!query.data || !channelId) return;

    const { messages: syncedMessages } = query.data;

    if (syncedMessages.length === 0) return;

    const result = mergeSyncedMessages(syncedMessages);

    // Apply main message updates
    if (
      result.mainUpdates.newMessages.length > 0 ||
      result.mainUpdates.editedMessages.size > 0 ||
      result.mainUpdates.deletedIds.size > 0
    ) {
      queryClient.setQueriesData(
        { queryKey: ["messages", channelId] },
        (old: MessagesQueryData | undefined) => {
          if (!old) {
            // Sync returns ASC order, message list is DESC — reverse for display
            const reversed = [...result.mainUpdates.newMessages].reverse();
            return {
              pages: [
                {
                  messages: reversed,
                  hasOlder: false,
                  hasNewer: false,
                },
              ],
              pageParams: [undefined],
            };
          }

          // Collect existing IDs for dedup (messages already received via WS)
          const existingIds = new Set<string>();
          old.pages.forEach((page) => {
            page.messages.forEach((msg) => existingIds.add(msg.id));
          });

          // Process each page: remove deleted, replace edited
          const updatedPages = old.pages.map((page) => {
            const processed = page.messages
              .filter((msg) => !result.mainUpdates.deletedIds.has(msg.id))
              .map(
                (msg) => result.mainUpdates.editedMessages.get(msg.id) || msg,
              );
            return { ...page, messages: processed };
          });

          // Dedup: only prepend messages not already in cache
          const genuinelyNew = result.mainUpdates.newMessages.filter(
            (m) => !existingIds.has(m.id),
          );

          if (genuinelyNew.length > 0) {
            // Sync returns ASC, message list is DESC — reverse before prepend
            const reversed = [...genuinelyNew].reverse();
            const firstPage = updatedPages[0];
            updatedPages[0] = {
              ...firstPage,
              messages: [...reversed, ...firstPage.messages],
            };
          }

          return { ...old, pages: updatedPages };
        },
      );
    }

    // Apply thread updates (best-effort — cache may not be loaded yet)
    // Thread cache pages use ThreadResponse objects from useInfiniteQuery.
    for (const [rootId, updates] of result.threadUpdates) {
      queryClient.setQueriesData(
        { queryKey: ["thread", rootId] },
        (old: ThreadQueryData | undefined) => {
          if (!old) return old;

          const existingIds = new Set(
            old.pages.flatMap((page) => page.replies.map((reply) => reply.id)),
          );
          const genuinelyNew = updates.new.filter(
            (message) => !existingIds.has(message.id),
          );
          const countDelta = genuinelyNew.length - updates.deletedIds.size;

          return {
            ...old,
            pages: old.pages.map((page, pageIndex) => {
              const processedReplies = page.replies
                .filter((reply) => !updates.deletedIds.has(reply.id))
                .map((reply) => updates.edited.get(reply.id) || reply);

              return {
                ...page,
                replies:
                  pageIndex === old.pages.length - 1
                    ? [...processedReplies, ...genuinelyNew]
                    : processedReplies,
                totalReplyCount: Math.max(
                  0,
                  (page.totalReplyCount ?? 0) + countDelta,
                ),
              };
            }),
          };
        },
      );

      // Also update the root message's replyCount in main cache
      if (updates.new.length > 0 || updates.deletedIds.size > 0) {
        queryClient.setQueriesData(
          { queryKey: ["messages", channelId] },
          (old: MessagesQueryData | undefined) => {
            if (!old) return old;
            const countDelta = updates.new.length - updates.deletedIds.size;
            const updatedPages = old.pages.map((page) => {
              const updated = page.messages.map((message) => {
                if (message.id !== rootId) return message;
                return {
                  ...message,
                  replyCount: Math.max(
                    0,
                    (message.replyCount ?? 0) + countDelta,
                  ),
                };
              });
              return { ...page, messages: updated };
            });
            return { ...old, pages: updatedPages };
          },
        );
      }
    }

    // Apply sub-reply updates (best-effort — cache may not be loaded yet)
    // Sub-reply cache pages use SubRepliesResponse objects from useInfiniteQuery.
    for (const [parentReplyId, updates] of result.subReplyUpdates) {
      queryClient.setQueriesData(
        { queryKey: ["subReplies", parentReplyId] },
        (old: SubRepliesQueryData | undefined) => {
          if (!old) return old;

          const existingIds = new Set(
            old.pages.flatMap((page) => page.replies.map((reply) => reply.id)),
          );
          const genuinelyNew = updates.new.filter(
            (message) => !existingIds.has(message.id),
          );

          return {
            ...old,
            pages: old.pages.map((page, pageIndex) => {
              const processedReplies = page.replies
                .filter((reply) => !updates.deletedIds.has(reply.id))
                .map((reply) => updates.edited.get(reply.id) || reply);

              return {
                ...page,
                replies:
                  pageIndex === old.pages.length - 1
                    ? [...processedReplies, ...genuinelyNew]
                    : processedReplies,
              };
            }),
          };
        },
      );
    }
  }, [query.data, channelId, queryClient]);

  return query;
}
