import { useRef, useMemo, useCallback, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import {
  Virtuoso,
  type VirtuosoHandle,
  type StateSnapshot,
} from "react-virtuoso";
import { Loader2 } from "lucide-react";
import type { Message, ChannelMember } from "@/types/im";
import { useCurrentUser } from "@/hooks/useAuth";
import { useChannelMembers } from "@/hooks/useChannels";
import { useThreadStore } from "@/hooks/useThread";
import {
  useDeleteMessage,
  useRetryMessage,
  useRemoveFailedMessage,
  useAddReaction,
  useRemoveReaction,
} from "@/hooks/useMessages";
import { useChannelScrollStore } from "@/hooks/useChannelScrollState";
import { useStreamingStore } from "@/stores/useStreamingStore";
import { MessageItem } from "./MessageItem";
import { StreamingMessageItem } from "./StreamingMessageItem";
import { BotThinkingIndicator } from "./BotThinkingIndicator";
import { NewMessagesIndicator } from "./NewMessagesIndicator";
import { UnreadDivider } from "./UnreadDivider";

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
  const { data: currentUser } = useCurrentUser();
  const openThread = useThreadStore((state) => state.openThread);

  const scrollStore = useChannelScrollStore();
  const scrollState = scrollStore.getChannelState(channelId);
  const showIndicator = scrollStore.shouldShowIndicator(channelId);

  // Restore scroll position from previous visit
  const savedSnapshot = useRef(scrollSnapshots.get(channelId));

  // Save scroll position on unmount (channel switch)
  useEffect(() => {
    return () => {
      virtuosoRef.current?.getState((state) => {
        scrollSnapshots.set(channelId, state);
      });
    };
  }, [channelId]);

  // Messages come in DESC order (newest first), reverse to chronological for Virtuoso
  const chronoMessages = useMemo(() => [...messages].reverse(), [messages]);

  // Stable firstItemIndex: only decreases when older messages are prepended (loaded
  // via infinite scroll at the top), NOT when new messages are appended at the bottom.
  // Without this, Virtuoso misinterprets appended messages as prepended items and
  // incorrectly adjusts the scroll offset, which can push the viewport to a blank area.
  const firstItemIndexRef = useRef(START_INDEX - chronoMessages.length);
  const prevFirstMsgIdRef = useRef<string | undefined>(chronoMessages[0]?.id);

  // Detect prepends vs appends by tracking the first (oldest) message ID.
  // - If the first ID changed, older messages were loaded → decrease firstItemIndex
  // - If the first ID is the same, new messages were appended → keep firstItemIndex
  // This runs during render (not in useEffect) so Virtuoso sees the correct value
  // on the same render pass that data changes.
  if (chronoMessages.length > 0) {
    const currentFirstId = chronoMessages[0]?.id;
    if (prevFirstMsgIdRef.current === undefined) {
      // Initial load
      firstItemIndexRef.current = START_INDEX - chronoMessages.length;
    } else if (currentFirstId !== prevFirstMsgIdRef.current) {
      // First message changed → older messages were prepended at the top
      const prevIdx = chronoMessages.findIndex(
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
    return chronoMessages.length - 1;
  }, [highlightMessageId, chronoMessages, firstUnreadIndex]);

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
      if (atBottom) {
        scrollStore.send(channelId, { type: "SCROLL_TO_BOTTOM" });
      } else {
        scrollStore.send(channelId, { type: "SCROLL_AWAY" });
      }
    },
    [channelId, scrollStore],
  );

  // Auto-scroll behavior: only follow new messages when user is at bottom
  const handleFollowOutput = useCallback((isAtBottom: boolean) => {
    if (isAtBottom) return "smooth" as const;
    return false as const;
  }, []);

  // Jump to latest handler
  const handleJumpToLatest = useCallback(() => {
    scrollStore.send(channelId, { type: "JUMP_TO_LATEST" });
    virtuosoRef.current?.scrollToIndex({
      index: chronoMessages.length - 1,
      behavior: "smooth",
    });
    // Transition to idle after the scroll animation
    setTimeout(() => {
      scrollStore.send(channelId, { type: "REFRESH_COMPLETE" });
    }, 500);
  }, [channelId, scrollStore, chronoMessages.length]);

  // Render individual message items
  const itemContent = useCallback(
    (index: number, message: Message) => {
      const hasReplies =
        !message.parentId && message.replyCount && message.replyCount > 0;
      const isHighlighted = highlightMessageId === message.id;
      // Show unread divider before the first unread message
      const chronoIndex = index - firstItemIndex;
      const showUnreadDivider =
        firstUnreadIndex >= 0 && chronoIndex === firstUnreadIndex;

      if (readOnly) {
        return (
          <div className="py-0.5">
            {showUnreadDivider && <UnreadDivider />}
            <MessageItem
              key={message.id}
              message={message}
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
            currentUserId={currentUser?.id}
            showReplyCount={Boolean(hasReplies)}
            onReplyCountClick={() => openThread(message.id)}
            isHighlighted={isHighlighted}
            channelId={channelId}
            isDirect={channelType === "direct"}
          />
        </div>
      );
    },
    [
      highlightMessageId,
      readOnly,
      currentUser?.id,
      openThread,
      channelId,
      channelType,
      firstUnreadIndex,
      firstItemIndex,
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
    <div className="flex-1 min-h-0 relative">
      <Virtuoso
        ref={virtuosoRef}
        data={chronoMessages}
        firstItemIndex={firstItemIndex}
        initialTopMostItemIndex={
          savedSnapshot.current ? undefined : initialTopMostItemIndex
        }
        restoreStateFrom={savedSnapshot.current ?? undefined}
        itemContent={itemContent}
        startReached={handleStartReached}
        endReached={handleEndReached}
        followOutput={handleFollowOutput}
        atBottomStateChange={handleAtBottomStateChange}
        atBottomThreshold={150}
        increaseViewportBy={{ top: 300, bottom: 100 }}
        className="px-4 overflow-x-hidden"
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
          Footer: () => (
            <div className="py-2">
              {hasNewer && isLoadingNewer ? (
                <div className="py-4 flex justify-center">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading newer messages...</span>
                  </div>
                </div>
              ) : (
                <StreamingMessages
                  channelId={channelId}
                  members={members}
                  thinkingBotIds={thinkingBotIds}
                />
              )}
            </div>
          ),
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
  currentUserId,
  showReplyCount,
  onReplyCountClick,
  isHighlighted,
  channelId,
  isDirect,
}: {
  message: Message;
  currentUserId?: string;
  showReplyCount?: boolean;
  onReplyCountClick?: () => void;
  isHighlighted?: boolean;
  channelId: string;
  isDirect: boolean;
}) {
  const openThread = useThreadStore((state) => state.openThread);
  const deleteMessage = useDeleteMessage();
  const retryMessage = useRetryMessage(channelId);
  const removeFailedMessage = useRemoveFailedMessage(channelId);
  const addReaction = useAddReaction(channelId);
  const removeReaction = useRemoveReaction(channelId);

  // Context menu handlers
  const handleReplyInThread = isDirect
    ? undefined
    : () => {
        openThread(message.id);
      };

  const handleEdit = () => {
    console.log("Edit message:", message.id);
    // TODO: Implement edit functionality
  };

  const handleDelete = () => {
    deleteMessage.mutate(message.id);
  };

  const handlePin = () => {
    console.log("Pin message:", message.id);
    // TODO: Implement pin functionality
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
    <MessageItem
      message={message}
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
    />
  );
}

// Show streaming messages or fall back to bot thinking indicator
function StreamingMessages({
  channelId,
  members,
  thinkingBotIds,
}: {
  channelId: string;
  members: ChannelMember[];
  thinkingBotIds: string[];
}) {
  const channelStreams = useStreamingStore(
    useShallow((state) =>
      Array.from(state.streams.values()).filter(
        (s) => s.channelId === channelId && !s.parentId,
      ),
    ),
  );

  if (channelStreams.length > 0) {
    return (
      <>
        {channelStreams.map((stream) => (
          <StreamingMessageItem
            key={stream.streamId}
            stream={stream}
            members={members}
          />
        ))}
      </>
    );
  }

  return (
    <BotThinkingIndicator thinkingBotIds={thinkingBotIds} members={members} />
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
