import { useEffect, useMemo, useState, useCallback } from "react";
import { useMessages, useSendMessage } from "@/hooks/useMessages";
import { useSyncChannel } from "@/hooks/useSyncChannel";
import {
  useChannel,
  useMarkAsRead,
  useChannelMembers,
} from "@/hooks/useChannels";
import { useUser } from "@/stores";
import { useThreadStore } from "@/hooks/useThread";
import { useBotStartupCountdown } from "@/hooks/useBotStartupCountdown";
import wsService from "@/services/websocket";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ChannelHeader } from "./ChannelHeader";
import { ThreadPanel } from "./ThreadPanel";
import { JoinChannelPrompt } from "./JoinChannelPrompt";
import { BotStartupOverlay } from "./BotStartupOverlay";
import { BotInstanceStoppedBanner } from "./BotInstanceStoppedBanner";
import { useOpenClawBotInstanceStatus } from "@/hooks/useOpenClawBotInstanceStatus";
import type { AttachmentDto, Message, PublicChannelPreview } from "@/types/im";
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
}: ChannelViewProps) {
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
  useSyncChannel(channelId);

  // Dual-layer thread state
  const primaryThread = useThreadStore((state) => state.primaryThread);
  const secondaryThread = useThreadStore((state) => state.secondaryThread);
  const openPrimaryThread = useThreadStore((state) => state.openPrimaryThread);
  const closePrimaryThread = useThreadStore(
    (state) => state.closePrimaryThread,
  );

  // Close thread panels when channel changes
  useEffect(() => {
    closePrimaryThread();
  }, [channelId, closePrimaryThread]);

  // Open thread panel from URL param on initial render
  useEffect(() => {
    if (initialThreadId && !primaryThread.isOpen) {
      openPrimaryThread(initialThreadId);
    }
  }, [initialThreadId, openPrimaryThread, primaryThread.isOpen]);

  const {
    data: messagesData,
    isLoading: messagesLoading,
    isFetchingNextPage,
    fetchNextPage,
    hasNextPage,
  } = useMessages(channelId);
  const sendMessage = useSendMessage(channelId);
  const markAsRead = useMarkAsRead();

  // Bot startup countdown for bot DM channels
  const { phase, remainingSeconds, startChatting, showOverlay } =
    useBotStartupCountdown({
      channel: memberChannel,
      members,
    });

  // Get current user's role in this channel
  const currentUserRole = useMemo(() => {
    if (!currentUser) return "member";
    const membership = members.find((m) => m.userId === currentUser.id);
    return membership?.role || "member";
  }, [members, currentUser]);

  // Bot thinking indicator state (local)
  const [thinkingBotIds, setThinkingBotIds] = useState<string[]>([]);
  // Determine if this is a bot DM channel
  const isBotDm = useMemo(() => {
    if (!memberChannel) return false;
    return (
      memberChannel.type === "direct" &&
      (memberChannel as any).otherUser?.userType === "bot"
    );
  }, [memberChannel]);

  const botDmUserId = useMemo(() => {
    if (!isBotDm) return null;
    return (memberChannel as any)?.otherUser?.id ?? null;
  }, [isBotDm, memberChannel]);

  // OpenClaw instance status for bot DM channels (to detect stopped instances)
  const {
    isInstanceStopped,
    isInstanceStarting,
    canStart,
    startInstance,
    isStarting,
  } = useOpenClawBotInstanceStatus(isBotDm ? botDmUserId : null);

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

  const messages = messagesData?.pages.flat() ?? [];
  // New messages are prepended to pages[0], so messages[0] is the latest
  const latestMessageId = messages.length > 0 ? messages[0]?.id : null;

  // Auto-mark messages as read when viewing the channel or when new messages arrive
  // Skip for preview mode (non-members)
  useEffect(() => {
    if (isPreviewMode) return;

    // Only mark as read if the messageId is a valid UUID (not a temporary ID)
    // Temporary IDs (e.g., "temp-1234567890-abc123") are used for optimistic updates
    // and should not be sent to the server as they don't exist in the database yet
    if (
      latestMessageId &&
      !messagesLoading &&
      isValidMessageId(latestMessageId)
    ) {
      markAsRead.mutate({
        channelId,
        messageId: latestMessageId,
      });
    }
  }, [channelId, latestMessageId, messagesLoading, isPreviewMode]);

  const handleSendMessage = async (
    content: string,
    attachments?: AttachmentDto[],
  ) => {
    // Allow sending if there's content or attachments
    if (!content.trim() && (!attachments || attachments.length === 0)) return;

    startBotThinking(content);
    await sendMessage.mutateAsync({ content, attachments });
  };

  if (channelLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Loading channel...</p>
      </div>
    );
  }

  if (!channel) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Channel not found</p>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* Main channel content */}
      <div className="flex-1 flex flex-col min-w-0">
        <ChannelHeader channel={channel} currentUserRole={currentUserRole} />

        {showOverlay ? (
          <BotStartupOverlay
            phase={phase as "countdown" | "ready"}
            remainingSeconds={remainingSeconds}
            onStartChatting={startChatting}
          />
        ) : (
          <MessageList
            messages={messages}
            isLoading={isFetchingNextPage}
            onLoadMore={() => {
              if (hasNextPage) fetchNextPage();
            }}
            hasMore={hasNextPage}
            highlightMessageId={initialMessageId}
            channelId={channelId}
            readOnly={isPreviewMode}
            thinkingBotIds={thinkingBotIds}
            members={members}
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

        {isPreviewMode ? (
          <JoinChannelPrompt
            channelId={channelId}
            channelName={channel.name || ""}
          />
        ) : (
          <MessageInput
            channelId={channelId}
            onSend={handleSendMessage}
            disabled={sendMessage.isPending || showOverlay}
            initialDraft={initialDraft}
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
          />
        )}
      {channel?.type !== "direct" &&
        secondaryThread.isOpen &&
        secondaryThread.rootMessageId && (
          <ThreadPanel
            level="secondary"
            rootMessageId={secondaryThread.rootMessageId}
          />
        )}
    </div>
  );
}
