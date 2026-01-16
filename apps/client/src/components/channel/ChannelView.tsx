import { useEffect, useMemo } from "react";
import { useChannel as useChannelWS } from "@/hooks/useWebSocket";
import { useMessages, useSendMessage } from "@/hooks/useMessages";
import {
  useChannel,
  useMarkAsRead,
  useChannelMembers,
} from "@/hooks/useChannels";
import { useUser } from "@/stores";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ChannelHeader } from "./ChannelHeader";
import type { AttachmentDto } from "@/types/im";

interface ChannelViewProps {
  channelId: string;
}

/**
 * ChannelView - Only renders for channel members
 * For non-members, use PublicChannelPreviewView instead
 */
export function ChannelView({ channelId }: ChannelViewProps) {
  const { data: channel, isLoading: channelLoading } = useChannel(channelId);
  const { data: members = [] } = useChannelMembers(channelId);
  const currentUser = useUser();

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

  // Auto-join channel via WebSocket
  useChannelWS(channelId);

  const messages = messagesData?.pages.flat() ?? [];
  const latestMessageId =
    messages.length > 0 ? messages[messages.length - 1]?.id : null;

  // Auto-mark messages as read when viewing the channel or when new messages arrive
  useEffect(() => {
    if (latestMessageId && !messagesLoading) {
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
    <div className="h-full flex flex-col">
      <ChannelHeader channel={channel} currentUserRole={currentUserRole} />

      <MessageList
        messages={messages}
        isLoading={isFetchingNextPage}
        onLoadMore={() => {
          if (hasNextPage) fetchNextPage();
        }}
        hasMore={hasNextPage}
      />

      <MessageInput
        channelId={channelId}
        onSend={handleSendMessage}
        disabled={sendMessage.isPending}
      />
    </div>
  );
}
