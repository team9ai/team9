import { useEffect } from "react";
import { useChannel as useChannelWS } from "@/hooks/useWebSocket";
import { useMessages, useSendMessage } from "@/hooks/useMessages";
import { useChannel, useMarkAsRead } from "@/hooks/useChannels";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import { ChannelHeader } from "./ChannelHeader";

interface ChannelViewProps {
  channelId: string;
}

export function ChannelView({ channelId }: ChannelViewProps) {
  const { data: channel, isLoading: channelLoading } = useChannel(channelId);
  const {
    data: messagesData,
    isLoading: messagesLoading,
    fetchNextPage,
    hasNextPage,
  } = useMessages(channelId);
  const sendMessage = useSendMessage(channelId);
  const markAsRead = useMarkAsRead();

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

  const handleSendMessage = async (content: string) => {
    if (!content.trim()) return;

    await sendMessage.mutateAsync({ content });
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
      <ChannelHeader channel={channel} />

      <MessageList
        messages={messages}
        isLoading={messagesLoading}
        onLoadMore={() => {
          if (hasNextPage) fetchNextPage();
        }}
        hasMore={hasNextPage}
      />

      <MessageInput
        onSend={handleSendMessage}
        disabled={sendMessage.isPending}
      />
    </div>
  );
}
