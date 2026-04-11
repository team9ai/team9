import { useRef, useMemo, useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import {
  Virtuoso,
  type VirtuosoHandle,
  type StateSnapshot,
} from "react-virtuoso";
import { Loader2 } from "lucide-react";
import type { Message, ChannelMember } from "@/types/im";
import { getAgentMeta, pairToolEvents } from "@/lib/agent-events";
import { useCurrentUser } from "@/hooks/useAuth";
import { useChannelMembers } from "@/hooks/useChannels";
import { useThreadStore } from "@/hooks/useThread";
import {
  useDeleteMessage,
  useRetryMessage,
  useRemoveFailedMessage,
  useAddReaction,
  useRemoveReaction,
  usePinMessage,
  useUnpinMessage,
  useUpdateMessage,
} from "@/hooks/useMessages";
import { useChannelScrollStore } from "@/hooks/useChannelScrollState";
import { useStreamingStore } from "@/stores/useStreamingStore";
import type { StreamingMessage } from "@/stores/useStreamingStore";
import { cn } from "@/lib/utils";
import { MessageItem } from "./MessageItem";
import { DeleteMessageDialog } from "./DeleteMessageDialog";
import { ToolCallBlock } from "./ToolCallBlock";
import { StreamingMessageItem } from "./StreamingMessageItem";
import { A2UISurfaceBlock } from "./A2UISurfaceBlock";
import { A2UIResponseItem } from "./A2UIResponseItem";
import { BotThinkingIndicator } from "./BotThinkingIndicator";
import { NewMessagesIndicator } from "./NewMessagesIndicator";
import { RoundCollapseSummary } from "./RoundCollapseSummary";
import { UnreadDivider } from "./UnreadDivider";
import {
  computeRoundFoldMaps,
  decideRoundRender,
  toggleExpandedRound,
} from "./message-list-fold";

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  onLoadMore: () => void;
  hasMore?: boolean;
  // Load newer messages (for anchored/unread mode)
  onLoadNewer?: () => void;
  hasNewer?: boolean;
  isLoadingNewer?: boolean;
  // Target message ID to scroll to and highlight
  highlightMessageId?: string;
  // Channel ID for retry failed messages
  channelId: string;
  // Channel type for conditional rendering (thread replies, empty state, etc.)
  channelType?: string;
  // Read-only mode for non-members previewing public channels
  readOnly?: boolean;
  // Bot thinking indicator
  thinkingBotIds?: string[];
  members?: ChannelMember[];
  // Last read message ID for unread divider positioning
  lastReadMessageId?: string;
}

// Large base index for prepending support via firstItemIndex
const START_INDEX = 100_000;

type ChannelListItem =
  | { type: "message"; message: Message }
  | { type: "stream"; stream: StreamingMessage }
  | { type: "thinking"; key: string };

// Per-channel scroll position snapshots for restoring on channel switch
const scrollSnapshots = new Map<string, StateSnapshot>();

export function MessageList({
  messages,
  isLoading,
  onLoadMore,
  hasMore,
  onLoadNewer,
  hasNewer,
  isLoadingNewer,
  highlightMessageId,
  channelId,
  channelType,
  readOnly = false,
  thinkingBotIds = [],
  members = [],
  lastReadMessageId,
}: MessageListProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(false);
  const { data: currentUser } = useCurrentUser();
  const openThread = useThreadStore((state) => state.openThread);
  const currentUserRole = useMemo(
    () => members.find((m) => m.userId === currentUser?.id)?.role,
    [members, currentUser?.id],
  );

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const updateMessage = useUpdateMessage();

  const handleEditStart = useCallback((messageId: string) => {
    setEditingMessageId(messageId);
  }, []);

  const handleEditSave = useCallback(
    async (messageId: string, content: string) => {
      try {
        await updateMessage.mutateAsync({ messageId, data: { content } });
        setEditingMessageId((cur) => (cur === messageId ? null : cur));
      } catch {
        // Edit mode stays open, content preserved in editor (clearOnSubmit=false)
      }
    },
    [updateMessage],
  );

  const handleEditCancel = useCallback(() => {
    setEditingMessageId(null);
  }, []);

  const scrollStore = useChannelScrollStore();
  const scrollState = scrollStore.getChannelState(channelId);
  const showIndicator = scrollStore.shouldShowIndicator(channelId);
  const channelStreams = useStreamingStore(
    useShallow((state) =>
      Array.from(state.streams.values()).filter(
        (stream) => stream.channelId === channelId && !stream.parentId,
      ),
    ),
  );
  const thinkingBotIdsKey = thinkingBotIds.join("|");
  const tailActivityKey = channelStreams
    .map(
      (stream) =>
        `${stream.streamId}:${stream.content.length}:${stream.thinking.length}:${stream.isThinking ? 1 : 0}`,
    )
    .join("|");

  // Restore scroll position from previous visit
  const savedSnapshot = useRef(scrollSnapshots.get(channelId));

  // Save scroll position on unmount (channel switch)
  useEffect(() => {
    const virtuoso = virtuosoRef.current;

    return () => {
      virtuoso?.getState((state) => {
        scrollSnapshots.set(channelId, state);
      });
    };
  }, [channelId]);

  // Messages come in DESC order (newest first), reverse to chronological for Virtuoso.
  // Keep raw order for stable firstItemIndex tracking, then apply tool pairing for display.
  const rawChrono = useMemo(() => [...messages].reverse(), [messages]);
  const chronoMessages = useMemo(() => pairToolEvents(rawChrono), [rawChrono]);
  const listData = useMemo<ChannelListItem[]>(() => {
    const items: ChannelListItem[] = chronoMessages.map((message) => ({
      type: "message",
      message,
    }));

    if (channelStreams.length > 0) {
      items.push(
        ...channelStreams.map((stream) => ({
          type: "stream" as const,
          stream,
        })),
      );
      return items;
    }

    if (thinkingBotIds.length > 0) {
      items.push({ type: "thinking", key: thinkingBotIdsKey });
    }

    return items;
  }, [
    chronoMessages,
    channelStreams,
    thinkingBotIds.length,
    thinkingBotIdsKey,
  ]);

  // Ref to listData for prevMessage lookup — avoids adding listData to useCallback deps
  const listDataRef = useRef(listData);
  listDataRef.current = listData;

  // Auto-fold state: in DM channels, non-latest agent rounds are collapsed
  // into a single "view execution process (N steps)" summary row. Users can
  // explicitly expand a collapsed round by clicking the summary, and we
  // remember that choice here so subsequent renders keep it expanded.
  //
  // Implementation: a Set of roundIds the user has expanded. The set is
  // reset whenever `channelId` changes (see useEffect below) so it cannot
  // grow unboundedly across channel switches. Within a single channel the
  // set only accumulates entries for rounds the user has actively expanded,
  // which is bounded by the number of rounds they click.
  const [userExpandedRounds, setUserExpandedRounds] = useState<Set<string>>(
    () => new Set(),
  );

  // Reset expanded-round state when switching channels. If MessageList is
  // unmounted+remounted on channel switch this is a harmless no-op; if it
  // stays mounted (e.g. re-keyed parent) we still clear stale ids that no
  // longer exist in the new channel's message list.
  useEffect(() => {
    setUserExpandedRounds(new Set());
  }, [channelId]);

  const foldMaps = useMemo(
    () =>
      computeRoundFoldMaps({
        channelType,
        chronoMessages,
        userExpandedRounds,
      }),
    [channelType, chronoMessages, userExpandedRounds],
  );

  // Ref to foldMaps for use inside stable itemContent callback.
  const foldMapsRef = useRef(foldMaps);
  foldMapsRef.current = foldMaps;

  const toggleRoundExpanded = useCallback((roundId: string) => {
    setUserExpandedRounds((prev) => toggleExpandedRound(prev, roundId));
  }, []);

  // Stable firstItemIndex: only decreases when older messages are prepended (loaded
  // via infinite scroll at the top), NOT when new messages are appended at the bottom.
  // Without this, Virtuoso misinterprets appended messages as prepended items and
  // incorrectly adjusts the scroll offset, which can push the viewport to a blank area.
  // NOTE: uses rawChrono (not chronoMessages) so that pairToolEvents reordering
  // doesn't falsely trigger the "prepend detected" branch.
  const firstItemIndexRef = useRef(START_INDEX - chronoMessages.length);
  const prevFirstMsgIdRef = useRef<string | undefined>(rawChrono[0]?.id);

  // Detect prepends vs appends by tracking the first (oldest) message ID.
  // - If the first ID changed, older messages were loaded → decrease firstItemIndex
  // - If the first ID is the same, new messages were appended → keep firstItemIndex
  // This runs during render (not in useEffect) so Virtuoso sees the correct value
  // on the same render pass that data changes.
  if (rawChrono.length > 0) {
    const currentFirstId = rawChrono[0]?.id;
    if (prevFirstMsgIdRef.current === undefined) {
      // Initial load
      firstItemIndexRef.current = START_INDEX - chronoMessages.length;
    } else if (currentFirstId !== prevFirstMsgIdRef.current) {
      // First message changed → older messages were prepended at the top
      const prevIdx = rawChrono.findIndex(
        (m) => m.id === prevFirstMsgIdRef.current,
      );
      if (prevIdx > 0) {
        firstItemIndexRef.current -= prevIdx;
      } else {
        // Previous first message not found → data was fully reset
        firstItemIndexRef.current = START_INDEX - chronoMessages.length;
      }
    }
    // Else: first message unchanged → append only → firstItemIndex stays the same
    prevFirstMsgIdRef.current = currentFirstId;
  } else {
    // Empty list reset
    firstItemIndexRef.current = START_INDEX;
    prevFirstMsgIdRef.current = undefined;
  }

  const firstItemIndex = firstItemIndexRef.current;

  // Find the index of the first unread message (message right after lastReadMessageId)
  const firstUnreadIndex = useMemo(() => {
    if (!lastReadMessageId) return -1;
    const lastReadIdx = chronoMessages.findIndex(
      (m) => m.id === lastReadMessageId,
    );
    if (lastReadIdx >= 0 && lastReadIdx < chronoMessages.length - 1) {
      return lastReadIdx + 1;
    }
    return -1;
  }, [lastReadMessageId, chronoMessages]);

  // Compute initial scroll position
  const initialTopMostItemIndex = useMemo(() => {
    if (highlightMessageId) {
      const idx = chronoMessages.findIndex((m) => m.id === highlightMessageId);
      if (idx >= 0) return idx;
    }
    // Scroll to the first unread message if available
    if (firstUnreadIndex >= 0) return firstUnreadIndex;
    // Default: scroll to bottom (latest message)
    return listData.length - 1;
  }, [highlightMessageId, chronoMessages, firstUnreadIndex, listData.length]);

  // Load older messages when scrolling to top
  const handleStartReached = useCallback(() => {
    if (hasMore && !isLoading) {
      scrollStore.send(channelId, { type: "LOAD_MORE" });
      onLoadMore();
    }
  }, [hasMore, isLoading, onLoadMore, channelId, scrollStore]);

  // Load newer messages when scrolling to bottom (anchored mode)
  const handleEndReached = useCallback(() => {
    if (hasNewer && !isLoadingNewer && onLoadNewer) {
      onLoadNewer();
    }
  }, [hasNewer, isLoadingNewer, onLoadNewer]);

  // Track bottom state changes
  const handleAtBottomStateChange = useCallback(
    (atBottom: boolean) => {
      isAtBottomRef.current = atBottom;
      if (atBottom) {
        scrollStore.send(channelId, { type: "SCROLL_TO_BOTTOM" });
      } else {
        scrollStore.send(channelId, { type: "SCROLL_AWAY" });
      }
    },
    [channelId, scrollStore],
  );

  useEffect(() => {
    if (!isAtBottomRef.current) return;

    const rafId = requestAnimationFrame(() => {
      virtuosoRef.current?.autoscrollToBottom();
    });

    return () => cancelAnimationFrame(rafId);
  }, [tailActivityKey, thinkingBotIdsKey]);

  // Auto-scroll behavior: only follow new messages when user is at bottom
  const handleFollowOutput = useCallback((isAtBottom: boolean) => {
    if (isAtBottom) return "smooth" as const;
    return false as const;
  }, []);

  // Pin tall messages: after a new message is appended and followOutput scrolls
  // to the bottom, check if the last message is taller than the viewport.
  // If so, scroll to show its beginning instead.
  const prevMessageCountRef = useRef(chronoMessages.length);
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = chronoMessages.length;

    if (chronoMessages.length <= prevCount) return;
    if (!isAtBottomRef.current) return;

    // Wait for followOutput's smooth scroll to settle and item to render
    const timeoutId = setTimeout(() => {
      if (!containerRef.current) return;

      const viewportHeight = containerRef.current.clientHeight;
      const items = containerRef.current.querySelectorAll("[data-item-index]");
      const lastItemEl = items[items.length - 1] as HTMLElement | null;
      if (!lastItemEl) return;

      const itemHeight = lastItemEl.getBoundingClientRect().height;
      if (itemHeight > viewportHeight * 0.85) {
        virtuosoRef.current?.scrollToIndex({
          index: listData.length - 1,
          align: "start",
          behavior: "auto",
        });
      }
    }, 150);

    return () => clearTimeout(timeoutId);
  }, [chronoMessages.length, listData.length]);

  // Jump to latest handler
  const handleJumpToLatest = useCallback(() => {
    scrollStore.send(channelId, { type: "JUMP_TO_LATEST" });
    virtuosoRef.current?.scrollToIndex({
      index: listData.length - 1,
      behavior: "smooth",
    });
    // Transition to idle after the scroll animation
    setTimeout(() => {
      scrollStore.send(channelId, { type: "REFRESH_COMPLETE" });
    }, 500);
  }, [channelId, scrollStore, listData.length]);

  // Render individual message items
  const itemContent = useCallback(
    (index: number, item: ChannelListItem) => {
      if (item.type === "stream") {
        return (
          <div className="py-2">
            <StreamingMessageItem stream={item.stream} members={members} />
          </div>
        );
      }

      if (item.type === "thinking") {
        return (
          <BotThinkingIndicator
            thinkingBotIds={thinkingBotIds}
            members={members}
          />
        );
      }

      const message = item.message;
      const itemIndex = index - firstItemIndex;
      const agentMeta = getAgentMeta(message);

      // Round auto-fold (DM only): if this message belongs to a folded round,
      // either render the collapse summary (for the round's first message) or
      // a 1px placeholder (for the rest). Non-DM channels and latest rounds
      // fall through to normal rendering.
      const foldDecision = decideRoundRender(message.id, foldMapsRef.current);
      if (foldDecision.kind === "summary") {
        return (
          <div className="py-0.5" data-round-summary-id={foldDecision.roundId}>
            <RoundCollapseSummary
              stepCount={foldDecision.stepCount}
              onClick={() => toggleRoundExpanded(foldDecision.roundId)}
            />
          </div>
        );
      }
      if (foldDecision.kind === "hidden") {
        return (
          <div
            className="min-h-px overflow-hidden"
            aria-hidden="true"
            data-round-hidden-id={foldDecision.roundId}
          />
        );
      }

      // Combined tool_call + tool_result block: render both in one card,
      // then hide the standalone tool_result item that follows.
      if (agentMeta?.agentEventType === "tool_call" && agentMeta.toolCallId) {
        const nextItem = listDataRef.current[itemIndex + 1];
        const nextMsg =
          nextItem?.type === "message" ? nextItem.message : undefined;
        const nextMeta = nextMsg ? getAgentMeta(nextMsg) : undefined;

        if (
          nextMeta?.agentEventType === "tool_result" &&
          nextMeta.toolCallId === agentMeta.toolCallId
        ) {
          const prevItem = listDataRef.current[itemIndex - 1];
          const prevIsAgentEvent =
            prevItem?.type === "message" && !!getAgentMeta(prevItem.message);
          const isFirstInGroup = !prevIsAgentEvent;

          return (
            <div
              id={`message-${message.id}`}
              className={cn(
                "ml-4 border-l-2 border-emerald-500/15 bg-emerald-500/[0.03] rounded-r-md pr-4",
                isFirstInGroup ? "mt-1 pt-1.5" : "",
                "pb-0.5",
              )}
              style={{ paddingLeft: "13px" }}
            >
              <ToolCallBlock
                callMetadata={agentMeta}
                resultMetadata={nextMeta}
                resultContent={nextMsg?.content ?? ""}
              />
            </div>
          );
        }
      }

      // Hide tool_result already rendered in the combined block above.
      // Use min-h-px (1px) instead of h-0 to avoid react-virtuoso zero-size warnings.
      if (agentMeta?.agentEventType === "tool_result" && agentMeta.toolCallId) {
        const prevItem = listDataRef.current[itemIndex - 1];
        const prevMsg =
          prevItem?.type === "message" ? prevItem.message : undefined;
        const prevMeta = prevMsg ? getAgentMeta(prevMsg) : undefined;

        if (
          prevMeta?.agentEventType === "tool_call" &&
          prevMeta.toolCallId === agentMeta.toolCallId
        ) {
          return (
            <div className="min-h-px overflow-hidden" aria-hidden="true" />
          );
        }
      }

      // A2UI surface block — render always, pass readOnly to suppress interactivity
      if (agentMeta?.agentEventType === "a2ui_surface_update") {
        return (
          <div id={`message-${message.id}`} className="px-4 py-1">
            <A2UISurfaceBlock
              message={message}
              metadata={agentMeta}
              readOnly={readOnly}
              channelId={channelId}
            />
          </div>
        );
      }

      // A2UI response — compact "User selected X" display
      if (agentMeta?.agentEventType === "a2ui_response") {
        return (
          <div
            id={`message-${message.id}`}
            className="ml-4 border-l-2 border-emerald-500/15 bg-emerald-500/[0.03] rounded-r-md pr-4 py-0.5"
            style={{ paddingLeft: "13px" }}
          >
            <A2UIResponseItem message={message} metadata={agentMeta} />
          </div>
        );
      }

      const hasReplies =
        !message.parentId && message.replyCount && message.replyCount > 0;
      const isHighlighted = highlightMessageId === message.id;
      // Show unread divider before the first unread message
      const chronoIndex = itemIndex;
      const showUnreadDivider =
        firstUnreadIndex >= 0 && chronoIndex === firstUnreadIndex;

      // Get previous message for agent event grouping
      const prevItem = listDataRef.current[itemIndex - 1];
      const prevMessage =
        prevItem?.type === "message" ? prevItem.message : undefined;

      if (readOnly) {
        return (
          <div className="py-0.5">
            {showUnreadDivider && <UnreadDivider />}
            <MessageItem
              key={message.id}
              message={message}
              prevMessage={prevMessage}
              isRootMessage={true}
              isHighlighted={isHighlighted}
            />
          </div>
        );
      }

      return (
        <div className="py-0.5">
          {showUnreadDivider && <UnreadDivider />}
          <ChannelMessageItem
            key={message.id}
            message={message}
            prevMessage={prevMessage}
            currentUserId={currentUser?.id}
            currentUserRole={currentUserRole}
            showReplyCount={Boolean(hasReplies)}
            onReplyCountClick={() => openThread(message.id)}
            isHighlighted={isHighlighted}
            channelId={channelId}
            isDirect={channelType === "direct"}
            editingMessageId={editingMessageId}
            isEditSaving={updateMessage.isPending}
            onEditStart={handleEditStart}
            onEditSave={handleEditSave}
            onEditCancel={handleEditCancel}
          />
        </div>
      );
    },
    // foldMaps drives summary/hidden rendering. We read via foldMapsRef but
    // still list the memoised maps as a dep so Virtuoso sees a fresh
    // itemContent identity when a user expands/collapses a round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      highlightMessageId,
      readOnly,
      currentUser?.id,
      currentUserRole,
      openThread,
      channelId,
      channelType,
      firstUnreadIndex,
      firstItemIndex,
      members,
      thinkingBotIds,
      toggleRoundExpanded,
      foldMaps,
      editingMessageId,
      updateMessage.isPending,
      handleEditStart,
      handleEditSave,
      handleEditCancel,
    ],
  );

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Loading messages...</p>
      </div>
    );
  }
  if (messages.length === 0) {
    return (
      <EmptyMessageState
        channelId={channelId}
        readOnly={readOnly}
        isPublic={channelType === "public"}
      />
    );
  }

  return (
    <div ref={containerRef} className="flex-1 min-h-0 relative">
      <Virtuoso
        ref={virtuosoRef}
        data={listData}
        firstItemIndex={firstItemIndex}
        alignToBottom
        initialTopMostItemIndex={
          savedSnapshot.current ? undefined : initialTopMostItemIndex
        }
        restoreStateFrom={savedSnapshot.current ?? undefined}
        computeItemKey={(_index, item) => {
          if (item.type === "message") return item.message.id;
          if (item.type === "stream") return `stream-${item.stream.streamId}`;
          return `thinking-${item.key}`;
        }}
        itemContent={itemContent}
        startReached={handleStartReached}
        endReached={handleEndReached}
        followOutput={handleFollowOutput}
        atBottomStateChange={handleAtBottomStateChange}
        atBottomThreshold={150}
        increaseViewportBy={{ top: 300, bottom: 100 }}
        className="h-full px-4 overflow-x-hidden"
        components={{
          Header: () =>
            hasMore && isLoading ? (
              <div className="py-4 flex justify-center">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Loading more messages...</span>
                </div>
              </div>
            ) : null,
          Footer: () =>
            hasNewer && isLoadingNewer ? (
              <div className="py-4 flex justify-center">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Loading newer messages...</span>
                </div>
              </div>
            ) : null,
        }}
      />

      {showIndicator && (
        <NewMessagesIndicator
          count={scrollState.context.newMessageCount}
          onClick={handleJumpToLatest}
        />
      )}
    </div>
  );
}

// Wrapper component for channel-specific message behavior
function ChannelMessageItem({
  message,
  prevMessage,
  currentUserId,
  currentUserRole,
  showReplyCount,
  onReplyCountClick,
  isHighlighted,
  channelId,
  isDirect,
  editingMessageId,
  isEditSaving,
  onEditStart,
  onEditSave,
  onEditCancel,
}: {
  message: Message;
  prevMessage?: Message;
  currentUserId?: string;
  currentUserRole?: string;
  showReplyCount?: boolean;
  onReplyCountClick?: () => void;
  isHighlighted?: boolean;
  channelId: string;
  isDirect: boolean;
  editingMessageId: string | null;
  isEditSaving: boolean;
  onEditStart: (messageId: string) => void;
  onEditSave: (messageId: string, content: string) => Promise<void>;
  onEditCancel: () => void;
}) {
  const openThread = useThreadStore((state) => state.openThread);
  const deleteMessage = useDeleteMessage();
  const retryMessage = useRetryMessage(channelId);
  const removeFailedMessage = useRemoveFailedMessage(channelId);
  const addReaction = useAddReaction(channelId);
  const removeReaction = useRemoveReaction(channelId);
  const pinMessage = usePinMessage(channelId);
  const unpinMessage = useUnpinMessage(channelId);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const isOwnMessage = currentUserId === message.senderId;
  const isAdmin = currentUserRole === "owner" || currentUserRole === "admin";
  const canDelete = isAdmin && !isOwnMessage;
  const isEditing = editingMessageId === message.id;

  // Context menu handlers
  const handleReplyInThread = isDirect
    ? undefined
    : () => {
        openThread(message.id);
      };

  const handleEdit = () => {
    onEditStart(message.id);
  };

  const handleDelete = () => {
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    deleteMessage.mutate(message.id);
    setDeleteDialogOpen(false);
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
  };

  const handlePin = () => {
    if (message.isPinned) {
      unpinMessage.mutate(message.id);
    } else {
      pinMessage.mutate(message.id);
    }
  };

  const handleRetry = () => {
    if (message._retryData) {
      retryMessage.mutate({
        tempId: message.id,
        retryData: message._retryData,
      });
    }
  };

  const handleRemoveFailed = () => {
    removeFailedMessage(message.id);
  };

  const handleAddReaction = (emoji: string) => {
    addReaction.mutate({ messageId: message.id, emoji });
  };

  const handleRemoveReaction = (emoji: string) => {
    removeReaction.mutate({ messageId: message.id, emoji });
  };

  return (
    <>
      <MessageItem
        message={message}
        prevMessage={prevMessage}
        currentUserId={currentUserId}
        showReplyCount={!isDirect && showReplyCount}
        onReplyCountClick={isDirect ? undefined : onReplyCountClick}
        isHighlighted={isHighlighted}
        onReplyInThread={handleReplyInThread ?? undefined}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onPin={handlePin}
        onRetry={handleRetry}
        onRemoveFailed={handleRemoveFailed}
        onAddReaction={handleAddReaction}
        onRemoveReaction={handleRemoveReaction}
        canDelete={canDelete}
        isEditing={isEditing}
        isEditSaving={isEditing && isEditSaving}
        onEditSave={(content) => onEditSave(message.id, content)}
        onEditCancel={onEditCancel}
      />
      <DeleteMessageDialog
        open={deleteDialogOpen}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />
    </>
  );
}

// Empty state with inline bot hint for public channels
function EmptyMessageState({
  channelId,
  readOnly,
  isPublic,
}: {
  channelId: string;
  readOnly: boolean;
  isPublic: boolean;
}) {
  const { t } = useTranslation("channel");
  const { data: members = [] } = useChannelMembers(
    readOnly ? undefined : channelId,
  );

  const botMembers = useMemo(
    () => members.filter((m) => m.user?.userType === "bot"),
    [members],
  );

  const botName =
    botMembers[0]?.user?.displayName || botMembers[0]?.user?.username || "Bot";

  return (
    <div className="flex-1 flex items-center justify-center px-4">
      {isPublic ? (
        <div className="flex flex-col items-center text-center max-w-sm gap-3">
          <img
            src="/bot.webp"
            alt={botName}
            className="w-16 h-16 rounded-full"
          />
          <h3 className="text-lg font-semibold">
            {t("emptyPublicChannelTitle")}
          </h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("emptyPublicChannelDesc")}
          </p>
          <div className="rounded-md bg-muted px-4 py-3 text-sm font-mono">
            <span className="text-primary font-semibold">@{botName}</span>{" "}
            <span className="text-muted-foreground">
              {t("emptyPublicChannelHintExample")}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground">{t("noMessagesYetDefault")}</p>
      )}
    </div>
  );
}
