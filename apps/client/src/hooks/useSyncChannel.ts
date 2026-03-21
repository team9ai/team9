import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import imApi from "@/services/api/im";
import type { Message, SyncMessageItem } from "@/types/im";

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
    type: item.type as Message["type"],
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
        (old: any) => {
          if (!old) {
            return {
              pages: [
                {
                  messages: result.mainUpdates.newMessages,
                  hasOlder: false,
                  hasNewer: false,
                },
              ],
              pageParams: [undefined],
            };
          }

          // Process each page: remove deleted, replace edited, then append new
          const updatedPages = old.pages.map((page: any) => {
            const msgs: Message[] = Array.isArray(page) ? page : page.messages;
            const processed = msgs
              .filter((m: Message) => !result.mainUpdates.deletedIds.has(m.id))
              .map(
                (m: Message) =>
                  result.mainUpdates.editedMessages.get(m.id) || m,
              );
            return Array.isArray(page)
              ? processed
              : { ...page, messages: processed };
          });

          // Prepend new messages to first page
          if (result.mainUpdates.newMessages.length > 0) {
            const firstPage = updatedPages[0];
            const firstPageMsgs: Message[] = Array.isArray(firstPage)
              ? firstPage
              : firstPage.messages;
            updatedPages[0] = Array.isArray(firstPage)
              ? [...result.mainUpdates.newMessages, ...firstPageMsgs]
              : {
                  ...firstPage,
                  messages: [
                    ...result.mainUpdates.newMessages,
                    ...firstPageMsgs,
                  ],
                };
          }

          return { ...old, pages: updatedPages };
        },
      );
    }

    // Apply thread updates (best-effort — cache may not be loaded yet)
    for (const [rootId, updates] of result.threadUpdates) {
      queryClient.setQueriesData(
        { queryKey: ["thread", rootId] },
        (old: any) => {
          if (!old) return old;
          const msgs: Message[] = Array.isArray(old) ? old : old.messages;
          const processed = msgs
            .filter((m: Message) => !updates.deletedIds.has(m.id))
            .map((m: Message) => updates.edited.get(m.id) || m);
          const merged = [...processed, ...updates.new];
          return Array.isArray(old) ? merged : { ...old, messages: merged };
        },
      );
    }

    // Apply sub-reply updates (best-effort — cache may not be loaded yet)
    for (const [parentReplyId, updates] of result.subReplyUpdates) {
      queryClient.setQueriesData(
        { queryKey: ["subReplies", parentReplyId] },
        (old: any) => {
          if (!old) return old;
          const msgs: Message[] = Array.isArray(old) ? old : old.messages;
          const processed = msgs
            .filter((m: Message) => !updates.deletedIds.has(m.id))
            .map((m: Message) => updates.edited.get(m.id) || m);
          const merged = [...processed, ...updates.new];
          return Array.isArray(old) ? merged : { ...old, messages: merged };
        },
      );
    }
  }, [query.data, channelId, queryClient]);

  return { ...query, hasMoreUnsynced: query.data?.hasMore ?? false };
}
