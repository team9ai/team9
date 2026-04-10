import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useChannelMessages, useSendMessage } from "@/hooks/useMessages";
import { useSyncChannel } from "@/hooks/useSyncChannel";
import {
  useChannel,
  useMarkAsRead,
  useChannelMembers,
} from "@/hooks/useChannels";
import { useUser } from "@/stores";
import { useThreadStore } from "@/hooks/useThread";
import { useBotStartupCountdown } from "@/hooks/useBotStartupCountdown";
import { useEffectOncePerKey } from "@/hooks/useEffectOncePerKey";
import wsService from "@/services/websocket";
import { ChannelContent } from "./ChannelContent";
import { ChannelHeader } from "./ChannelHeader";
import { ThreadPanel } from "./ThreadPanel";
import { JoinChannelPrompt } from "./JoinChannelPrompt";
import { BotStartupOverlay } from "./BotStartupOverlay";
import { BotInstanceStoppedBanner } from "./BotInstanceStoppedBanner";
import { useOpenClawBotInstanceStatus } from "@/hooks/useOpenClawBotInstanceStatus";
import type {
  AttachmentDto,
  ChannelWithUnread,
  Message,
  PublicChannelPreview,
} from "@/types/im";
import { isValidMessageId } from "@/lib/utils";

// Extract mentioned bot user IDs directly from message HTML content
// Uses data-user-type attribute embedded in mention tags by the editor
function extractMentionedBotIds(content: string): string[] {
  const mentionRegex = /data-user-id="([^"]*)"[^>]*data-user-type="bot"/g;
  const botIds: string[] = [];
  let match;
  while ((match = mentionRegex.exec(content)) !== null) {
    botIds.push(match[1]);
  }
  return botIds;
}

interface ChannelViewProps {
  channelId: string;
  // Initial thread ID from URL - opens thread panel when set
  initialThreadId?: string;
  // Initial message ID from URL - for scrolling/highlighting (future use)
  initialMessageId?: string;
  // Draft text to pre-fill in the message input
  initialDraft?: string;
  // Preview channel data for non-members (public channel preview mode)
  previewChannel?: PublicChannelPreview;
  // Hide the built-in ChannelHeader (e.g. when a parent component provides its own header)
  hideHeader?: boolean;
  // Show a read-only bar instead of the message input
  readOnly?: boolean;
}

/**
 * ChannelView - Renders channel for both members and non-members (preview mode)
 * When previewChannel is provided, shows read-only preview with join prompt
 */
export function ChannelView({
  channelId,
  initialThreadId,
  initialMessageId,
  initialDraft,
  previewChannel,
  hideHeader,
  readOnly,
}: ChannelViewProps) {
  const { t } = useTranslation("channel");
  const isPreviewMode = !!previewChannel;
  const { data: memberChannel, isLoading: channelLoading } = useChannel(
    isPreviewMode ? undefined : channelId,
  );
  const { data: members = [] } = useChannelMembers(
    isPreviewMode ? undefined : channelId,
  );
  const currentUser = useUser();

  // Use preview channel data or fetched channel data
  const channel = previewChannel || memberChannel;

  // Sync missed messages when opening channel (lazy loading)
  const { hasMoreUnsynced } = useSyncChannel(channelId);

  // Dual-layer thread state
  const primaryThread = useThreadStore((state) => state.primaryThread);
  const secondaryThread = useThreadStore((state) => state.secondaryThread);
  const openPrimaryThread = useThreadStore((state) => state.openPrimaryThread);
  const closePrimaryThread = useThreadStore(
    (state) => state.closePrimaryThread,
  );

  // Track whether the initial thread from URL has already been consumed
  const initialThreadConsumed = useRef(false);

  // Close thread panels when channel changes
  useEffect(() => {
    closePrimaryThread();
    initialThreadConsumed.current = false;
  }, [channelId, closePrimaryThread]);

  // Open thread panel from URL param (once per channel, not re-triggered on close)
  useEffect(() => {
    if (initialThreadId && !initialThreadConsumed.current) {
      initialThreadConsumed.current = true;
      openPrimaryThread(initialThreadId);
    }
  }, [initialThreadId, openPrimaryThread]);

  // Determine if we should anchor to the last read message (unread positioning)
  const unreadAnchor = useMemo(() => {
    if (isPreviewMode || !memberChannel) return undefined;
    const ch = memberChannel as ChannelWithUnread;
    // Anchor when there are unreads with a known position, within reasonable range
    if (ch.unreadCount > 0 && ch.lastReadMessageId && ch.unreadCount <= 200) {
      return ch.lastReadMessageId;
    }
    return undefined;
  }, [isPreviewMode, memberChannel]);

  const {
    data: messagesData,
    isLoading: messagesLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
    hasPreviousPage,
    isFetchingPreviousPage,
    fetchPreviousPage,
  } = useChannelMessages(channelId, { anchorMessageId: unreadAnchor });
  const sendMessage = useSendMessage(channelId);
  const markAsRead = useMarkAsRead();
  const dmOtherUser = (memberChannel as ChannelWithUnread | undefined)
    ?.otherUser;

  // Determine if this is a bot DM channel
  const isBotDm = useMemo(() => {
    if (!memberChannel) return false;
    return memberChannel.type === "direct" && dmOtherUser?.userType === "bot";
  }, [dmOtherUser, memberChannel]);

  const botDmUserId = useMemo(() => {
    if (!isBotDm) return null;
    return dmOtherUser?.id ?? null;
  }, [dmOtherUser, isBotDm]);

  // OpenClaw instance status for bot DM channels (to detect stopped instances)
  const {
    isInstanceStopped,
    isInstanceStarting,
    isOpenClawBot,
    canStart,
    startInstance,
    isStarting,
  } = useOpenClawBotInstanceStatus(isBotDm ? botDmUserId : null);

  // Bot startup countdown — only for OpenClaw bots (they need instance spin-up)
  const { phase, remainingSeconds, startChatting, showOverlay } =
    useBotStartupCountdown({
      channel: memberChannel,
      members,
      isOpenClawBot,
    });

  // Get current user's role in this channel
  const currentUserRole = useMemo(() => {
    if (!currentUser) return "member";
    const membership = members.find((m) => m.userId === currentUser.id);
    return membership?.role || "member";
  }, [members, currentUser]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [isSnapped, setIsSnapped] = useState(false);
  const [threadPanelWidth, setThreadPanelWidth] = useState(640);
  const threadPanelWidthRef = useRef(threadPanelWidth);
  threadPanelWidthRef.current = threadPanelWidth;

  const threadPanelCount =
    (primaryThread.isOpen ? 1 : 0) + (secondaryThread.isOpen ? 1 : 0);

  // Bot thinking indicator state (local)
  const [thinkingBotIds, setThinkingBotIds] = useState<string[]>([]);

  // Clear thinking state when channel changes
  useEffect(() => {
    setThinkingBotIds([]);
  }, [channelId]);

  // Listen for bot replies or streaming start via WebSocket to dismiss thinking indicator
  useEffect(() => {
    if (thinkingBotIds.length === 0) return;

    const handleBotReply = (message: Message) => {
      if (message.channelId !== channelId) return;
      if (message.sender?.userType === "bot" && message.senderId) {
        setThinkingBotIds((prev) =>
          prev.filter((id) => id !== message.senderId),
        );
      }
    };

    const handleStreamingStart = (data: {
      channelId: string;
      senderId: string;
    }) => {
      if (data.channelId !== channelId) return;
      // Streaming started — remove bot from thinking indicators
      setThinkingBotIds((prev) => prev.filter((id) => id !== data.senderId));
    };

    wsService.onNewMessage(handleBotReply);
    wsService.onStreamingStart(handleStreamingStart);
    return () => {
      wsService.off("new_message", handleBotReply);
      wsService.off("streaming_start", handleStreamingStart);
    };
  }, [channelId, thinkingBotIds.length]);

  // Trigger thinking indicator after sending a message
  const startBotThinking = useCallback(
    (content: string) => {
      let botIds: string[] = [];

      if (isBotDm && botDmUserId) {
        // DM with bot: always trigger
        botIds = [botDmUserId];
      } else if (
        memberChannel?.type === "public" ||
        memberChannel?.type === "private"
      ) {
        // Public/private channel: trigger only if @mentioning a bot
        botIds = extractMentionedBotIds(content);
      }

      if (botIds.length > 0) {
        setThinkingBotIds(botIds);
      }
    },
    [isBotDm, botDmUserId, memberChannel?.type],
  );

  const messages = messagesData?.pages.flatMap((p) => p.messages) ?? [];
  // New messages are prepended to pages[0].messages, so messages[0] is the latest
  const latestMessageId = messages.length > 0 ? messages[0]?.id : null;

  // Auto-mark messages as read when viewing the channel or when new messages arrive
  // Skip for preview mode (non-members)
  // In anchored mode, only mark as read when there are no newer pages to load,
  // because messages[0] may not be the true latest message otherwise.
  useEffectOncePerKey(
    latestMessageId,
    Boolean(
      latestMessageId &&
      !isPreviewMode &&
      !hasPreviousPage &&
      !messagesLoading &&
      isValidMessageId(latestMessageId),
    ),
    (messageId) => {
      markAsRead.mutate({
        channelId,
        messageId,
      });
    },
  );

  // Monitor outer container width and calculate whether snap mode is needed
  // We observe the outer flex container (never hidden) rather than the main chat
  // div (which becomes hidden in snap mode and would stop firing ResizeObserver).
  // Also recalculate when threadPanelWidth changes (ResizeObserver won't fire
  // because the outer container size doesn't change when children resize).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || threadPanelCount === 0) {
      setIsSnapped(false);
      return;
    }

    const recalc = () => {
      const containerWidth = el.getBoundingClientRect().width;
      const mainChatWidth =
        containerWidth - threadPanelCount * threadPanelWidthRef.current;
      setIsSnapped(mainChatWidth < 400);
    };

    // Recalculate immediately for threadPanelWidth changes
    recalc();

    const observer = new ResizeObserver(() => recalc());
    observer.observe(el);
    return () => observer.disconnect();
  }, [threadPanelCount, threadPanelWidth]);

  const handleSendMessage = async (
    content: string,
    attachments?: AttachmentDto[],
  ) => {
    // Allow sending if there's content or attachments
    if (!content.trim() && (!attachments || attachments.length === 0)) return;

    startBotThinking(content);
    try {
      await sendMessage.mutateAsync({ content, attachments });
    } catch {
      // Clear thinking indicators on send failure to avoid stale state
      setThinkingBotIds([]);
    }
  };

  if (channelLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">{t("loadingChannel")}</p>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">{t("channelNotFound")}</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full flex">
      {/* Main channel content */}
      <div
        className={`flex-1 flex flex-col min-w-0 ${isSnapped ? "hidden" : ""}`}
      >
        {!hideHeader && (
          <ChannelHeader channel={channel} currentUserRole={currentUserRole} />
        )}

        {showOverlay ? (
          <BotStartupOverlay
            phase={phase as "countdown" | "ready"}
            remainingSeconds={remainingSeconds}
            onStartChatting={startChatting}
          />
        ) : messagesLoading && messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground">{t("loadingMessages")}</p>
          </div>
        ) : (
          <ChannelContent
            channelId={channelId}
            channelType={channel?.type}
            messages={messages}
            isLoading={isFetchingNextPage}
            onLoadMore={() => {
              if (hasNextPage) fetchNextPage();
            }}
            hasMore={hasNextPage}
            onLoadNewer={() => {
              if (hasPreviousPage) fetchPreviousPage();
            }}
            hasNewer={hasPreviousPage}
            isLoadingNewer={isFetchingPreviousPage}
            highlightMessageId={initialMessageId}
            readOnly={isPreviewMode}
            thinkingBotIds={thinkingBotIds}
            members={members}
            lastReadMessageId={unreadAnchor}
            hasMoreUnsynced={hasMoreUnsynced}
            showReadOnlyBar={isPreviewMode || readOnly}
            onSend={isPreviewMode || readOnly ? undefined : handleSendMessage}
            isSendDisabled={sendMessage.isPending || showOverlay}
            initialDraft={initialDraft}
          />
        )}

        {(isInstanceStopped || isInstanceStarting) && (
          <BotInstanceStoppedBanner
            onStart={startInstance}
            isStarting={isStarting}
            canStart={canStart}
            isInstanceStarting={isInstanceStarting}
          />
        )}

        {isPreviewMode && (
          <JoinChannelPrompt
            channelId={channelId}
            channelName={channel.name || ""}
          />
        )}
      </div>

      {/* Thread panel sidebars - up to 2 layers (hidden for direct messages) */}
      {channel?.type !== "direct" &&
        primaryThread.isOpen &&
        primaryThread.rootMessageId && (
          <ThreadPanel
            level="primary"
            rootMessageId={primaryThread.rootMessageId}
            highlightMessageId={initialThreadId ? initialMessageId : undefined}
            isSnapped={isSnapped}
            width={threadPanelWidth}
            onWidthChange={setThreadPanelWidth}
          />
        )}
      {channel?.type !== "direct" &&
        secondaryThread.isOpen &&
        secondaryThread.rootMessageId && (
          <ThreadPanel
            level="secondary"
            rootMessageId={secondaryThread.rootMessageId}
            isSnapped={isSnapped}
            width={threadPanelWidth}
            onWidthChange={setThreadPanelWidth}
          />
        )}
    </div>
  );
}
