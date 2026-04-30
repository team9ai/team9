import { useRef, useCallback, useEffect, useState, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { X, Loader2, ArrowDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Button } from "@/components/ui/button";
import {
  useThreadPanelForLevel,
  useSendThreadReply,
  useThreadStore,
  useAddThreadReaction,
  useRemoveThreadReaction,
  type ThreadLevel,
} from "@/hooks/useThread";
import { useCurrentUser } from "@/hooks/useAuth";
import { useChannelMembers } from "@/hooks/useChannels";
import { useStreamingStore } from "@/stores/useStreamingStore";
import type { StreamingMessage } from "@/stores/useStreamingStore";
import wsService from "@/services/websocket";
import { MessageItem } from "./MessageItem";
import { MessageInput } from "./MessageInput";
import { StreamingMessageParts } from "./StreamingMessageParts";
import { BotThinkingIndicator } from "./BotThinkingIndicator";
import { ResizeHandle } from "./ResizeHandle";
import { PropertyPanel } from "./properties/PropertyPanel";
import type { ThreadReply, AttachmentDto, Message } from "@/types/im";

// Extract mentioned bot user IDs from message HTML content
function extractMentionedBotIds(content: string): string[] {
  const mentionRegex = /data-user-id="([^"]*)"[^>]*data-user-type="bot"/g;
  const botIds: string[] = [];
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    botIds.push(match[1]);
  }
  return botIds;
}

interface ThreadPanelProps {
  level: ThreadLevel;
  rootMessageId: string;
  // Target message ID to scroll to and highlight in thread
  highlightMessageId?: string;
  isSnapped?: boolean;
  width?: number;
  onWidthChange?: (width: number) => void;
}

type ThreadListItem =
  | { type: "reply"; reply: ThreadReply }
  | { type: "stream"; stream: StreamingMessage }
  | { type: "thinking"; key: string };

export function ThreadPanel({
  level,
  rootMessageId,
  highlightMessageId,
  isSnapped = false,
  width = 600,
  onWidthChange,
}: ThreadPanelProps) {
  const { t } = useTranslation("thread");
  const {
    threadData,
    isLoading,
    replyingTo,
    isFetchingNextPage,
    canOpenNestedThread,
    // State machine
    newMessageCount,
    shouldShowNewMessageIndicator,
    isJumpingToLatest,
    handleScrollPositionChange,
    jumpToLatest,
    // UI actions
    closeThread,
    openNestedThread,
    clearReplyingTo,
  } = useThreadPanelForLevel(level, rootMessageId);
  const { data: currentUser } = useCurrentUser();
  const sendReply = useSendThreadReply(rootMessageId, level);

  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(false);

  // Channel ID and members for streaming/thinking indicators
  const channelId = threadData?.rootMessage.channelId;
  const { data: members = [] } = useChannelMembers(channelId);

  // Bot thinking indicator state
  const [thinkingBotIds, setThinkingBotIds] = useState<string[]>([]);
  const thinkingBotIdsKey = thinkingBotIds.join("|");

  // Thread-specific streaming messages
  const threadStreams = useStreamingStore(
    useShallow((state) =>
      Array.from(state.streams.values()).filter(
        (s) => s.channelId === channelId && s.parentId === rootMessageId,
      ),
    ),
  );

  const tailActivityKey = threadStreams
    .map(
      (s) =>
        `${s.streamId}:${s.content.length}:${s.thinking.length}:${s.isThinking ? 1 : 0}`,
    )
    .join("|");

  // Build Virtuoso list data: replies + streaming + thinking
  const threadListData = useMemo<ThreadListItem[]>(() => {
    if (!threadData) return [];

    const items: ThreadListItem[] = threadData.replies.map((reply) => ({
      type: "reply" as const,
      reply,
    }));

    if (threadStreams.length > 0) {
      items.push(
        ...threadStreams.map((stream) => ({
          type: "stream" as const,
          stream,
        })),
      );
    } else if (thinkingBotIds.length > 0) {
      items.push({ type: "thinking", key: thinkingBotIdsKey });
    }

    return items;
  }, [threadData, threadStreams, thinkingBotIds.length, thinkingBotIdsKey]);

  // Compute initial scroll position
  const initialTopMostItemIndex = useMemo(() => {
    if (!threadData) return 0;
    if (highlightMessageId) {
      const idx = threadData.replies.findIndex(
        (r) => r.id === highlightMessageId,
      );
      if (idx >= 0) return idx;
    }
    return Math.max(0, threadListData.length - 1);
  }, [highlightMessageId, threadData, threadListData.length]);

  // Track bottom state and notify state machine
  const handleAtBottomStateChange = useCallback(
    (atBottom: boolean) => {
      isAtBottomRef.current = atBottom;
      handleScrollPositionChange(atBottom);
    },
    [handleScrollPositionChange],
  );

  // Auto-follow new messages when user is at bottom.
  // Use "auto" (instant) so the scroll settles immediately and doesn't
  // fight the pin-tall-message adjustment below.
  const handleFollowOutput = useCallback((isAtBottom: boolean) => {
    if (isAtBottom) return "auto" as const;
    return false as const;
  }, []);

  // Smart auto-scroll: follow new content at the bottom, and when no active
  // streams are running, pin tall messages to the top so the user sees the
  // beginning (header + first lines) instead of the end.
  useEffect(() => {
    if (!isAtBottomRef.current) return;

    const rafId = requestAnimationFrame(() => {
      virtuosoRef.current?.autoscrollToBottom();

      if (threadStreams.length === 0) {
        requestAnimationFrame(() => {
          if (!containerRef.current) return;

          const viewportHeight = containerRef.current.clientHeight;
          const items =
            containerRef.current.querySelectorAll("[data-item-index]");
          const lastItemEl = items[items.length - 1] as HTMLElement | null;
          if (!lastItemEl) return;

          const itemHeight = lastItemEl.getBoundingClientRect().height;
          if (itemHeight > viewportHeight * 0.85) {
            virtuosoRef.current?.scrollToIndex({
              index: threadListData.length - 1,
              align: "start",
              behavior: "auto",
            });
          }
        });
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [
    tailActivityKey,
    thinkingBotIdsKey,
    threadListData.length,
    threadStreams.length,
  ]);

  // Handle jumping to bottom when clicking new message indicator
  const handleJumpToBottom = useCallback(async () => {
    await jumpToLatest();

    setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: threadListData.length - 1,
        behavior: "smooth",
      });
    }, 100);
  }, [jumpToLatest, threadListData.length]);

  // Determine bots actively participating in this thread:
  // 1. Root message sender is a bot (e.g. secondary thread replying to bot's message)
  // 2. Root message @mentions a bot (e.g. primary thread started by @bot)
  // 3. A bot has replied in the thread (bot is already engaged)
  const participatingBotIds = useMemo(() => {
    if (!threadData) return [];
    const botIds = new Set<string>();

    if (
      threadData.rootMessage.sender?.userType === "bot" &&
      threadData.rootMessage.senderId
    ) {
      botIds.add(threadData.rootMessage.senderId);
    }

    for (const id of extractMentionedBotIds(threadData.rootMessage.content)) {
      botIds.add(id);
    }

    for (const reply of threadData.replies) {
      if (reply.sender?.userType === "bot" && reply.senderId) {
        botIds.add(reply.senderId);
      }
    }

    return Array.from(botIds);
  }, [threadData]);

  // Clear thinking state when thread changes
  useEffect(() => {
    setThinkingBotIds([]);
  }, [rootMessageId]);

  // Keep a ref of all message IDs in this thread for sub-reply matching
  const threadMessageIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = new Set<string>([rootMessageId]);
    if (threadData) {
      for (const reply of threadData.replies) {
        ids.add(reply.id);
      }
    }
    threadMessageIdsRef.current = ids;
  }, [threadData, rootMessageId]);

  // Listen for bot replies or streaming start to dismiss thinking indicator
  useEffect(() => {
    if (thinkingBotIds.length === 0 || !channelId) return;

    const handleBotReply = (message: Message) => {
      if (message.channelId !== channelId) return;
      // Match direct replies to root or sub-replies to any message in this thread
      if (
        !message.parentId ||
        !threadMessageIdsRef.current.has(message.parentId)
      )
        return;
      if (message.sender?.userType === "bot" && message.senderId) {
        setThinkingBotIds((prev) =>
          prev.filter((id) => id !== message.senderId),
        );
      }
    };

    const handleStreamingStart = (data: {
      channelId: string;
      senderId: string;
      parentId?: string;
    }) => {
      if (data.channelId !== channelId) return;
      if (!data.parentId || !threadMessageIdsRef.current.has(data.parentId))
        return;
      setThinkingBotIds((prev) => prev.filter((id) => id !== data.senderId));
    };

    wsService.onNewMessage(handleBotReply);
    wsService.onStreamingStart(handleStreamingStart);
    return () => {
      wsService.off("new_message", handleBotReply);
      wsService.off("streaming_start", handleStreamingStart);
    };
  }, [channelId, rootMessageId, thinkingBotIds.length]);

  // Handle send reply with optional attachments
  const handleSendReply = async (
    payload: { content: string; contentAst?: Record<string, unknown> },
    attachments?: AttachmentDto[],
  ) => {
    const { content, contentAst } = payload;
    if (!content.trim() && (!attachments || attachments.length === 0)) return;

    // Detect bots that should respond
    const mentionedBotIds = extractMentionedBotIds(content);
    const botIds = Array.from(
      new Set([...participatingBotIds, ...mentionedBotIds]),
    );

    if (botIds.length > 0) {
      setThinkingBotIds(botIds);
    }

    await sendReply.mutateAsync({ content, contentAst, attachments });
  };

  // Render individual list items
  const itemContent = useCallback(
    (_index: number, item: ThreadListItem) => {
      if (item.type === "stream") {
        // Always render the thinking row while streaming — see the
        // parallel comment in MessageList.tsx for why this isn't gated
        // on thinking content.
        return (
          <div className="py-0.5">
            <StreamingMessageParts stream={item.stream} members={members} />
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

      return (
        <ThreadReplyItem
          reply={item.reply}
          currentUserId={currentUser?.id}
          rootMessageId={rootMessageId}
          level={level}
          canOpenNestedThread={canOpenNestedThread}
          onOpenNestedThread={openNestedThread}
          isHighlighted={highlightMessageId === item.reply.id}
        />
      );
    },
    [
      members,
      thinkingBotIds,
      currentUser?.id,
      rootMessageId,
      level,
      canOpenNestedThread,
      openNestedThread,
      highlightMessageId,
    ],
  );

  return (
    <div
      className={`${isSnapped ? "flex-1" : ""} border-l bg-background flex flex-col h-full relative select-text`}
      style={isSnapped ? undefined : { width: `${width}px` }}
    >
      {!isSnapped && onWidthChange && (
        <ResizeHandle
          width={width}
          onWidthChange={onWidthChange}
          maxWidth={1000}
        />
      )}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">{t("loading")}</p>
        </div>
      ) : threadData ? (
        <>
          <div ref={containerRef} className="flex-1 min-h-0 relative">
            {/* Floating toolbar */}
            <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={closeThread}
                className="h-8 w-8 bg-background/80 backdrop-blur-sm shadow-sm"
              >
                <X size={16} />
              </Button>
            </div>

            <Virtuoso
              ref={virtuosoRef}
              data={threadListData}
              alignToBottom
              initialTopMostItemIndex={initialTopMostItemIndex}
              computeItemKey={(_index, item) => {
                if (item.type === "reply") return item.reply.id;
                if (item.type === "stream")
                  return `stream-${item.stream.streamId}`;
                return `thinking-${item.key}`;
              }}
              itemContent={itemContent}
              followOutput={handleFollowOutput}
              atBottomStateChange={handleAtBottomStateChange}
              atBottomThreshold={100}
              increaseViewportBy={{ top: 200, bottom: 100 }}
              className="h-full px-4 overflow-x-hidden"
              components={{
                Header: () => (
                  <div className="pt-4 space-y-1">
                    <MessageItem
                      message={threadData.rootMessage}
                      currentUserId={currentUser?.id}
                      compact
                      isRootMessage
                    />
                    {channelId && (
                      <PropertyPanel
                        channelId={channelId}
                        messageId={threadData.rootMessage.id}
                        className="px-2 py-1"
                      />
                    )}
                    <div className="mb-2 text-xs text-muted-foreground">
                      {t("repliesCount", {
                        count: threadData.totalReplyCount,
                      })}
                    </div>
                    <div className="border-b mb-2" />
                  </div>
                ),
                Footer: () =>
                  isFetchingNextPage ? (
                    <div className="flex justify-center items-center py-3 gap-2 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">{t("loadingMore")}</span>
                    </div>
                  ) : null,
              }}
            />

            {/* New message indicator */}
            {shouldShowNewMessageIndicator && (
              <button
                onClick={handleJumpToBottom}
                disabled={isJumpingToLatest}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-info text-primary-foreground text-sm rounded-full shadow-lg hover:bg-info/90 transition-colors"
              >
                {isJumpingToLatest ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ArrowDown size={16} />
                )}
                <span>{t("newMessages", { count: newMessageCount })}</span>
              </button>
            )}
          </div>

          {/* Input - using shared MessageInput component */}
          <MessageInput
            channelId={threadData.rootMessage.channelId}
            replyingTo={replyingTo}
            onClearReplyingTo={clearReplyingTo}
            onSend={handleSendReply}
            disabled={sendReply.isPending}
          />
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">{t("error")}</p>
        </div>
      )}
    </div>
  );
}

// Thread reply item - uses shared MessageItem with sub-reply count
function ThreadReplyItem({
  reply,
  currentUserId,
  rootMessageId,
  level,
  canOpenNestedThread = false,
  onOpenNestedThread,
  isHighlighted = false,
}: {
  reply: ThreadReply;
  currentUserId?: string;
  rootMessageId: string;
  level: ThreadLevel;
  canOpenNestedThread?: boolean;
  onOpenNestedThread?: (messageId: string) => void;
  isHighlighted?: boolean;
}) {
  // Get unread sub-reply count for this reply
  const unreadCount = useThreadStore((state) =>
    state.getUnreadSubReplyCount(reply.id),
  );

  const addReaction = useAddThreadReaction(rootMessageId, level);
  const removeReaction = useRemoveThreadReaction(rootMessageId, level);

  // Handle opening this reply in a new thread panel
  const handleOpenInNewPanel = () => {
    if (canOpenNestedThread && onOpenNestedThread) {
      onOpenNestedThread(reply.id);
    }
  };

  // Handle reply in thread action from context menu
  const handleReplyInThread =
    canOpenNestedThread && onOpenNestedThread
      ? () => onOpenNestedThread(reply.id)
      : undefined;

  const handleAddReaction = (emoji: string) => {
    addReaction.mutate({ messageId: reply.id, emoji });
  };

  const handleRemoveReaction = (emoji: string) => {
    removeReaction.mutate({ messageId: reply.id, emoji });
  };

  return (
    <div>
      {/* First-level reply using shared MessageItem */}
      <MessageItem
        message={reply}
        currentUserId={currentUserId}
        compact
        showReplyCount={canOpenNestedThread && reply.subReplyCount > 0}
        onReplyCountClick={handleOpenInNewPanel}
        unreadSubReplyCount={unreadCount}
        isHighlighted={isHighlighted}
        onReplyInThread={handleReplyInThread}
        onAddReaction={handleAddReaction}
        onRemoveReaction={handleRemoveReaction}
      />
    </div>
  );
}
