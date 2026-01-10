import { useEffect, useRef, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Loader2 } from "lucide-react";
import type { Message } from "@/types/im";
import { formatMessageTime } from "@/lib/date-utils";
import { useCurrentUser } from "@/hooks/useAuth";
import { MessageContent } from "./MessageContent";
import { MessageAttachments } from "./MessageAttachments";

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
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const prevMessagesLength = useRef(0);
  const prevScrollHeight = useRef(0);
  const isInitialLoad = useRef(true);
  const { data: currentUser } = useCurrentUser();

  // Scroll to bottom on initial load
  useEffect(() => {
    if (isInitialLoad.current && messages.length > 0) {
      // Use setTimeout to ensure DOM is rendered
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
      }, 0);
      isInitialLoad.current = false;
      prevMessagesLength.current = messages.length;
    }
  }, [messages.length]);

  // Auto-scroll to bottom on new messages (not on load more)
  useEffect(() => {
    if (
      !isInitialLoad.current &&
      messages.length > prevMessagesLength.current &&
      prevScrollHeight.current === 0
    ) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevMessagesLength.current = messages.length;
  }, [messages.length]);

  // Intersection Observer for infinite scroll
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [target] = entries;
      if (target.isIntersecting && hasMore && !isLoading) {
        // Store current scroll height before loading more
        const viewport = scrollAreaRef.current?.querySelector(
          "[data-radix-scroll-area-viewport]",
        );
        if (viewport) {
          prevScrollHeight.current = viewport.scrollHeight;
        }
        onLoadMore();
      }
    },
    [hasMore, isLoading, onLoadMore],
  );

  useEffect(() => {
    const element = loadMoreTriggerRef.current;
    if (!element) return;

    const option = {
      root: scrollAreaRef.current?.querySelector(
        "[data-radix-scroll-area-viewport]",
      ),
      rootMargin: "100px",
      threshold: 0,
    };

    const observer = new IntersectionObserver(handleObserver, option);
    observer.observe(element);

    return () => observer.disconnect();
  }, [handleObserver]);

  // Maintain scroll position after loading more messages
  useEffect(() => {
    if (prevScrollHeight.current > 0) {
      const viewport = scrollAreaRef.current?.querySelector(
        "[data-radix-scroll-area-viewport]",
      );
      if (viewport) {
        const newScrollHeight = viewport.scrollHeight;
        const heightDiff = newScrollHeight - prevScrollHeight.current;
        viewport.scrollTop = heightDiff;
        prevScrollHeight.current = 0;
      }
    }
  }, [messages]);

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
    <ScrollArea ref={scrollAreaRef} className="flex-1 min-h-0 px-4">
      {hasMore && (
        <div ref={loadMoreTriggerRef} className="py-4 flex justify-center">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading more messages...</span>
            </div>
          ) : (
            <div className="h-4" />
          )}
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

  const hasContent = Boolean(message.content?.trim());
  const hasAttachments = message.attachments && message.attachments.length > 0;

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
              {formatMessageTime(new Date(message.createdAt))}
            </span>
          </div>
          {hasContent && (
            <div className="bg-purple-600 text-white rounded-lg px-4 py-2 w-fit max-w-sm message-content-own">
              <MessageContent
                content={message.content}
                className="text-sm whitespace-pre-wrap wrap-break-word"
              />
            </div>
          )}
          {hasAttachments && (
            <MessageAttachments
              attachments={message.attachments!}
              isOwnMessage={true}
            />
          )}
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
            {formatMessageTime(new Date(message.createdAt))}
          </span>
          {message.isEdited && (
            <span className="text-xs text-muted-foreground">(edited)</span>
          )}
        </div>
        {hasContent && (
          <div className="bg-slate-100 rounded-lg px-4 py-2 w-fit max-w-sm message-content-other">
            <MessageContent
              content={message.content}
              className="text-sm whitespace-pre-wrap wrap-break-word"
            />
          </div>
        )}
        {hasAttachments && (
          <MessageAttachments
            attachments={message.attachments!}
            isOwnMessage={false}
          />
        )}
      </div>
    </div>
  );
}
