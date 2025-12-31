import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { Message } from "@/types/im";
import { formatDistanceToNow } from "@/lib/date-utils";

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  onLoadMore: () => void;
  hasMore?: boolean;
}

export function MessageList({
  messages,
  isLoading,
  onLoadMore,
  hasMore,
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMessagesLength = useRef(messages.length);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > prevMessagesLength.current) {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
    prevMessagesLength.current = messages.length;
  }, [messages.length]);

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Loading messages...</p>
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">No messages yet</p>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1 min-h-0 px-4" ref={scrollRef}>
      {hasMore && (
        <div className="py-4 text-center">
          <button
            onClick={onLoadMore}
            className="text-sm text-purple-600 hover:underline"
          >
            Load more messages
          </button>
        </div>
      )}

      <div className="space-y-4 py-4">
        {[...messages].reverse().map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
      </div>
    </ScrollArea>
  );
}

function MessageItem({ message }: { message: Message }) {
  if (message.isDeleted) {
    return (
      <div className="flex gap-3 opacity-50">
        <div className="w-9 h-9" />
        <div className="flex-1">
          <p className="text-sm text-muted-foreground italic">
            This message was deleted
          </p>
        </div>
      </div>
    );
  }

  const initials =
    message.sender?.displayName?.[0] || message.sender?.username?.[0] || "?";

  return (
    <div className="flex gap-3 hover:bg-muted/50 px-2 py-1 rounded">
      <Avatar className="w-9 h-9">
        <AvatarFallback className="bg-gradient-to-br from-purple-400 to-purple-600 text-white text-sm">
          {initials.toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm">
            {message.sender?.displayName ||
              message.sender?.username ||
              "Unknown User"}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(message.createdAt))}
          </span>
          {message.isEdited && (
            <span className="text-xs text-muted-foreground">(edited)</span>
          )}
        </div>
        <p className="text-sm whitespace-pre-wrap break-words">
          {message.content}
        </p>
      </div>
    </div>
  );
}
