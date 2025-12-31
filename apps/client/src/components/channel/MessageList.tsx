import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { Message } from "@/types/im";
import { formatDistanceToNow } from "@/lib/date-utils";
import { useCurrentUser } from "@/hooks/useAuth";

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMessagesLength = useRef(messages.length);
  const { data: currentUser } = useCurrentUser();

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > prevMessagesLength.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
    <ScrollArea className="flex-1 min-h-0 px-4">
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
          <MessageItem
            key={message.id}
            message={message}
            currentUserId={currentUser?.id}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>
    </ScrollArea>
  );
}

function MessageItem({
  message,
  currentUserId,
}: {
  message: Message;
  currentUserId?: string;
}) {
  const isOwnMessage = currentUserId === message.senderId;

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

  if (isOwnMessage) {
    // Own message - right aligned
    return (
      <div className="flex justify-end gap-3 px-2 py-1">
        <div className="flex flex-col items-end">
          <div className="flex items-baseline gap-2 mb-1">
            {message.isEdited && (
              <span className="text-xs text-muted-foreground">(edited)</span>
            )}
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(message.createdAt))}
            </span>
          </div>
          <div className="bg-purple-600 text-white rounded-lg px-4 py-2 w-fit max-w-sm">
            <p className="text-sm whitespace-pre-wrap wrap-break-word">
              {message.content}
            </p>
          </div>
        </div>
        <Avatar className="w-9 h-9 shrink-0">
          <AvatarFallback className="bg-linear-to-br from-purple-400 to-purple-600 text-white text-sm">
            {initials.toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </div>
    );
  }

  // Other's message - left aligned
  return (
    <div className="flex gap-3 px-2 py-1">
      <Avatar className="w-9 h-9 shrink-0">
        <AvatarFallback className="bg-linear-to-br from-purple-400 to-purple-600 text-white text-sm">
          {initials.toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="flex flex-col items-start">
        <div className="flex items-baseline gap-2 mb-1">
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
        <div className="bg-slate-100 rounded-lg px-4 py-2 w-fit max-w-sm">
          <p className="text-sm whitespace-pre-wrap wrap-break-word">
            {message.content}
          </p>
        </div>
      </div>
    </div>
  );
}
