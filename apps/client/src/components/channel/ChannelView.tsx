import { useEffect, useMemo } from "react";
import { useMessages, useSendMessage } from "@/hooks/useMessages";
import { useSyncChannel } from "@/hooks/useSyncChannel";
import {
  useChannel,
  useMarkAsRead,
  useChannelMembers,
} from "@/hooks/useChannels";
import { useUser } from "@/stores";
import { useThreadStore } from "@/hooks/useThread";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ChannelHeader } from "./ChannelHeader";
import { ThreadPanel } from "./ThreadPanel";
import type { AttachmentDto } from "@/types/im";
import { isValidMessageId } from "@/lib/utils";

interface ChannelViewProps {
  channelId: string;
  // Initial thread ID from URL - opens thread panel when set
  initialThreadId?: string;
  // Initial message ID from URL - for scrolling/highlighting (future use)
  initialMessageId?: string;
}

/**
 * ChannelView - Only renders for channel members
 * For non-members, use PublicChannelPreviewView instead
 */
export function ChannelView({
  channelId,
  initialThreadId,
  initialMessageId,
}: ChannelViewProps) {
  const { data: channel, isLoading: channelLoading } = useChannel(channelId);
  const { data: members = [] } = useChannelMembers(channelId);
  const currentUser = useUser();

  // Sync missed messages when opening channel (lazy loading)
  useSyncChannel(channelId);

  // Dual-layer thread state
  const primaryThread = useThreadStore((state) => state.primaryThread);
  const secondaryThread = useThreadStore((state) => state.secondaryThread);
  const openPrimaryThread = useThreadStore((state) => state.openPrimaryThread);

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

  // Get current user's role in this channel
  const currentUserRole = useMemo(() => {
    if (!currentUser) return "member";
    const membership = members.find((m) => m.userId === currentUser.id);
    return membership?.role || "member";
  }, [members, currentUser]);

  const messages = messagesData?.pages.flat() ?? [];
  // New messages are prepended to pages[0], so messages[0] is the latest
  const latestMessageId = messages.length > 0 ? messages[0]?.id : null;

  // Auto-mark messages as read when viewing the channel or when new messages arrive
  useEffect(() => {
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
  }, [channelId, latestMessageId, messagesLoading]);

  const handleSendMessage = async (
    content: string,
    attachments?: AttachmentDto[],
  ) => {
    // Allow sending if there's content or attachments
    if (!content.trim() && (!attachments || attachments.length === 0)) return;

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

        <MessageList
          messages={messages}
          isLoading={isFetchingNextPage}
          onLoadMore={() => {
            if (hasNextPage) fetchNextPage();
          }}
          hasMore={hasNextPage}
          highlightMessageId={initialMessageId}
          channelId={channelId}
        />

        <MessageInput
          channelId={channelId}
          onSend={handleSendMessage}
          disabled={sendMessage.isPending}
        />
      </div>

      {/* Thread panel sidebars - up to 2 layers */}
      {primaryThread.isOpen && primaryThread.rootMessageId && (
        <ThreadPanel
          level="primary"
          rootMessageId={primaryThread.rootMessageId}
          highlightMessageId={initialThreadId ? initialMessageId : undefined}
        />
      )}
      {secondaryThread.isOpen && secondaryThread.rootMessageId && (
        <ThreadPanel
          level="secondary"
          rootMessageId={secondaryThread.rootMessageId}
        />
      )}
    </div>
  );
}
