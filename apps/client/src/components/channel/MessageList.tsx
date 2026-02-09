import { useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import type { Message } from "@/types/im";
import { useCurrentUser } from "@/hooks/useAuth";
import { useChannel, useChannelMembers } from "@/hooks/useChannels";
import { useThreadStore } from "@/hooks/useThread";
import {
  useDeleteMessage,
  useRetryMessage,
  useRemoveFailedMessage,
} from "@/hooks/useMessages";
import { MessageItem } from "./MessageItem";

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  onLoadMore: () => void;
  hasMore?: boolean;
  // Target message ID to scroll to and highlight
  highlightMessageId?: string;
  // Channel ID for retry failed messages
  channelId: string;
  // Read-only mode for non-members previewing public channels
  readOnly?: boolean;
}

export function MessageList({
  messages,
  isLoading,
  onLoadMore,
  hasMore,
  highlightMessageId,
  channelId,
  readOnly = false,
}: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const prevMessagesLength = useRef(0);
  const prevScrollHeight = useRef(0);
  const isInitialLoad = useRef(true);
  const hasScrolledToHighlight = useRef(false);
  const { data: currentUser } = useCurrentUser();
  const openThread = useThreadStore((state) => state.openThread);

  // Scroll to highlighted message or bottom on initial load
  useEffect(() => {
    if (isInitialLoad.current && messages.length > 0) {
      // Use setTimeout to ensure DOM is rendered
      setTimeout(() => {
        // If we have a highlight target, scroll to it instead of bottom
        if (highlightMessageId && !hasScrolledToHighlight.current) {
          const targetElement = document.getElementById(
            `message-${highlightMessageId}`,
          );
          if (targetElement) {
            targetElement.scrollIntoView({
              behavior: "instant",
              block: "center",
            });
            hasScrolledToHighlight.current = true;
          } else {
            // Message not in current view, scroll to bottom
            messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
          }
        } else {
          messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
        }
      }, 0);
      isInitialLoad.current = false;
      prevMessagesLength.current = messages.length;
    }
  }, [messages.length, highlightMessageId]);

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
    return <EmptyMessageState channelId={channelId} readOnly={readOnly} />;
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
        {[...messages].reverse().map((message) => {
          // Only show reply count for root messages (messages without parentId)
          const hasReplies =
            !message.parentId && message.replyCount && message.replyCount > 0;
          const isHighlighted = highlightMessageId === message.id;

          // Read-only mode: render without context menu and interactions
          if (readOnly) {
            return (
              <MessageItem
                key={message.id}
                message={message}
                isRootMessage={true}
                isHighlighted={isHighlighted}
              />
            );
          }

          return (
            <ChannelMessageItem
              key={message.id}
              message={message}
              currentUserId={currentUser?.id}
              showReplyCount={Boolean(hasReplies)}
              onReplyCountClick={() => openThread(message.id)}
              isHighlighted={isHighlighted}
              channelId={channelId}
            />
          );
        })}
        <div ref={messagesEndRef} />
      </div>
    </ScrollArea>
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
}: {
  message: Message;
  currentUserId?: string;
  showReplyCount?: boolean;
  onReplyCountClick?: () => void;
  isHighlighted?: boolean;
  channelId: string;
}) {
  const { data: channel } = useChannel(channelId);
  const isDirect = channel?.type === "direct";
  const openThread = useThreadStore((state) => state.openThread);
  const deleteMessage = useDeleteMessage();
  const retryMessage = useRetryMessage(channelId);
  const removeFailedMessage = useRemoveFailedMessage(channelId);

  // Context menu handlers
  const handleReply = () => {
    console.log("Reply to message:", message.id);
    // TODO: Implement reply functionality
  };

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

  return (
    <MessageItem
      message={message}
      currentUserId={currentUserId}
      showReplyCount={!isDirect && showReplyCount}
      onReplyCountClick={isDirect ? undefined : onReplyCountClick}
      isHighlighted={isHighlighted}
      onReply={isDirect ? undefined : handleReply}
      onReplyInThread={handleReplyInThread ?? undefined}
      onEdit={handleEdit}
      onDelete={handleDelete}
      onPin={handlePin}
      onRetry={handleRetry}
      onRemoveFailed={handleRemoveFailed}
    />
  );
}

// Empty state with inline bot hint for public channels
function EmptyMessageState({
  channelId,
  readOnly,
}: {
  channelId: string;
  readOnly: boolean;
}) {
  const { t } = useTranslation("channel");
  const { data: channel } = useChannel(channelId);
  const { data: members = [] } = useChannelMembers(
    readOnly ? undefined : channelId,
  );

  const botMembers = useMemo(
    () => members.filter((m) => m.user?.userType === "bot"),
    [members],
  );

  const isPublic = channel?.type === "public";

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
