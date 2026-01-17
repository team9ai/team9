import { useRef, useCallback, useEffect } from "react";
import { X, MessageSquare, Loader2, ArrowDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  useThreadPanelForLevel,
  useSendThreadReply,
  useThreadStore,
  type ThreadLevel,
} from "@/hooks/useThread";
import { useCurrentUser } from "@/hooks/useAuth";
import { MessageContent } from "./MessageContent";
import { MessageAttachments } from "./MessageAttachments";
import { MessageContextMenu } from "./MessageContextMenu";
import { RichTextEditor } from "./editor";
import { formatMessageTime } from "@/lib/date-utils";
import type { Message, ThreadReply } from "@/types/im";
import { cn } from "@/lib/utils";

interface ThreadPanelProps {
  level: ThreadLevel;
  rootMessageId: string;
}

export function ThreadPanel({ level, rootMessageId }: ThreadPanelProps) {
  const { t } = useTranslation("thread");
  const {
    threadData,
    isLoading,
    replyingTo,
    isFetchingNextPage,
    canOpenNestedThread,
    // State machine
    scrollState,
    newMessageCount,
    shouldShowNewMessageIndicator,
    isJumpingToLatest,
    handleScrollPositionChange,
    jumpToLatest,
    // UI actions
    closeThread,
    openNestedThread,
    setReplyingTo,
    clearReplyingTo,
  } = useThreadPanelForLevel(level, rootMessageId);
  const { data: currentUser } = useCurrentUser();

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Track scroll position and notify state machine
  const handleScroll = useCallback(() => {
    const viewport = scrollAreaRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    if (!viewport) return;

    const { scrollTop, scrollHeight, clientHeight } = viewport;
    // Consider "at bottom" if within 100px of the bottom
    const atBottom = scrollHeight - scrollTop - clientHeight < 100;

    // Notify state machine of scroll position change
    handleScrollPositionChange(atBottom);
  }, [handleScrollPositionChange]);

  // Set up scroll listener
  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector(
      "[data-radix-scroll-area-viewport]",
    );
    if (!viewport) return;

    viewport.addEventListener("scroll", handleScroll);
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Check initial scroll position when thread data loads
  // This confirms the user's position and transitions from initializing state
  useEffect(() => {
    if (!threadData || isLoading) return;

    // Use requestAnimationFrame to ensure DOM has rendered
    const rafId = requestAnimationFrame(() => {
      const viewport = scrollAreaRef.current?.querySelector(
        "[data-radix-scroll-area-viewport]",
      );
      if (!viewport) return;

      const { scrollTop, scrollHeight, clientHeight } = viewport;
      // Consider "at bottom" if within 100px of the bottom
      const atBottom = scrollHeight - scrollTop - clientHeight < 100;

      // Notify state machine of initial position
      // This will transition from initializing to idle (if at bottom) or browsing (if not)
      handleScrollPositionChange(atBottom);
    });

    return () => cancelAnimationFrame(rafId);
  }, [threadData, isLoading, handleScrollPositionChange]);

  // Track previous replies count to detect new messages
  const prevRepliesCountRef = useRef<number>(0);

  // Auto-scroll to bottom when new messages arrive while in idle state
  useEffect(() => {
    if (!threadData || scrollState !== "idle") return;

    const currentCount = threadData.replies.length;
    const prevCount = prevRepliesCountRef.current;

    // Update ref for next comparison
    prevRepliesCountRef.current = currentCount;

    // If count increased and we're in idle state, scroll to bottom
    if (currentCount > prevCount && prevCount > 0) {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    }
  }, [threadData, scrollState]);

  // Handle jumping to bottom when clicking new message indicator
  const handleJumpToBottom = useCallback(async () => {
    await jumpToLatest();

    // Scroll to bottom after data loads
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  }, [jumpToLatest]);

  return (
    <div className="w-96 border-l bg-white flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <MessageSquare size={20} className="text-slate-600" />
          <h2 className="font-semibold">{t("title")}</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={closeThread}>
          <X size={20} />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-muted-foreground">{t("loading")}</p>
        </div>
      ) : threadData ? (
        <>
          {/* Root message */}
          <div className="px-4 py-3 border-b bg-slate-50">
            <ThreadMessage
              message={threadData.rootMessage}
              currentUserId={currentUser?.id}
              isRootMessage
            />
            <div className="mt-2 text-xs text-muted-foreground">
              {t("repliesCount", { count: threadData.totalReplyCount })}
            </div>
          </div>

          {/* Replies container with relative positioning for the indicator */}
          <div className="flex-1 min-h-0 relative">
            <ScrollArea ref={scrollAreaRef} className="h-full">
              <div className="px-4 py-2 space-y-1">
                {threadData.replies.map((reply: ThreadReply) => (
                  <ThreadReplyItem
                    key={reply.id}
                    reply={reply}
                    currentUserId={currentUser?.id}
                    onReplyTo={(messageId: string, senderName: string) =>
                      setReplyingTo({ messageId, senderName })
                    }
                    canOpenNestedThread={canOpenNestedThread}
                    onOpenNestedThread={openNestedThread}
                  />
                ))}

                {/* Loading indicator for infinite scroll */}
                {isFetchingNextPage && (
                  <div className="flex justify-center items-center py-3 gap-2 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">{t("loadingMore")}</span>
                  </div>
                )}

                {/* Bottom anchor for scrolling */}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            {/* New message indicator */}
            {shouldShowNewMessageIndicator && (
              <button
                onClick={handleJumpToBottom}
                disabled={isJumpingToLatest}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-full shadow-lg hover:bg-blue-700 transition-colors"
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

          {/* Input */}
          <ThreadInputArea
            rootMessageId={rootMessageId}
            level={level}
            replyingTo={replyingTo}
            onClearReplyingTo={clearReplyingTo}
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

// Thread message component (simplified version of MessageItem)
function ThreadMessage({
  message,
  currentUserId,
  isRootMessage = false,
  onReplyTo,
  indent = false,
  canOpenNestedThread = false,
  onOpenNestedThread,
}: {
  message: Message;
  currentUserId?: string;
  isRootMessage?: boolean;
  onReplyTo?: (messageId: string, senderName: string) => void;
  canOpenNestedThread?: boolean;
  onOpenNestedThread?: (messageId: string) => void;
  indent?: boolean;
}) {
  const isOwnMessage = currentUserId === message.senderId;

  if (message.isDeleted) {
    return (
      <div className={cn("flex gap-2 py-1", indent && "ml-6")}>
        <div className="w-8 h-8" />
        <p className="text-sm text-muted-foreground italic">
          This message was deleted
        </p>
      </div>
    );
  }

  const initials =
    message.sender?.displayName?.[0] || message.sender?.username?.[0] || "?";
  const senderName =
    message.sender?.displayName || message.sender?.username || "Unknown";

  const hasContent = Boolean(message.content?.trim());
  const hasAttachments = message.attachments && message.attachments.length > 0;

  // Handle reply action - either open nested thread or set replying to
  const handleReplyInThread = () => {
    if (isRootMessage) return;

    // If can open nested thread, open it; otherwise set replying to this message
    if (canOpenNestedThread && onOpenNestedThread) {
      onOpenNestedThread(message.id);
    } else if (onReplyTo) {
      onReplyTo(message.id, senderName);
    }
  };

  const content = (
    <div className={cn("flex gap-2 py-2", indent && "ml-6")}>
      <Avatar className="w-8 h-8 shrink-0">
        <AvatarFallback className="bg-linear-to-br from-purple-400 to-purple-600 text-white text-xs">
          {initials.toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-sm">{senderName}</span>
          <span className="text-xs text-muted-foreground">
            {formatMessageTime(new Date(message.createdAt))}
          </span>
          {message.isEdited && (
            <span className="text-xs text-muted-foreground">(edited)</span>
          )}
        </div>
        {hasContent && (
          <div className="mt-1">
            <MessageContent
              content={message.content}
              className="text-sm whitespace-pre-wrap break-words"
            />
          </div>
        )}
        {hasAttachments && (
          <MessageAttachments
            attachments={message.attachments!}
            isOwnMessage={isOwnMessage}
          />
        )}
      </div>
    </div>
  );

  // Only wrap with context menu if it's not a root message
  if (isRootMessage) {
    return content;
  }

  return (
    <MessageContextMenu
      message={message}
      isOwnMessage={isOwnMessage}
      onReplyInThread={handleReplyInThread}
    >
      {content}
    </MessageContextMenu>
  );
}

// Thread reply item - simplified, sub-replies shown in secondary panel
function ThreadReplyItem({
  reply,
  currentUserId,
  onReplyTo,
  canOpenNestedThread = false,
  onOpenNestedThread,
}: {
  reply: ThreadReply;
  currentUserId?: string;
  onReplyTo: (messageId: string, senderName: string) => void;
  canOpenNestedThread?: boolean;
  onOpenNestedThread?: (messageId: string) => void;
}) {
  const { t } = useTranslation("thread");

  // Get unread sub-reply count for this reply
  const unreadCount = useThreadStore((state) =>
    state.getUnreadSubReplyCount(reply.id),
  );

  // Handle opening this reply in a new thread panel
  const handleOpenInNewPanel = () => {
    if (canOpenNestedThread && onOpenNestedThread) {
      onOpenNestedThread(reply.id);
    }
  };

  return (
    <div>
      {/* First-level reply */}
      <ThreadMessage
        message={reply}
        currentUserId={currentUserId}
        onReplyTo={onReplyTo}
        canOpenNestedThread={canOpenNestedThread}
        onOpenNestedThread={onOpenNestedThread}
      />

      {/* Reply count button to open in new panel */}
      {canOpenNestedThread && reply.subReplyCount > 0 && (
        <button
          onClick={handleOpenInNewPanel}
          className="ml-10 mt-1 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 hover:underline"
        >
          <MessageSquare size={14} />
          <span>{t("repliesCount", { count: reply.subReplyCount })}</span>
          {/* Unread sub-reply badge */}
          {unreadCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-medium rounded-full min-w-4.5 text-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}

// Thread input area with replying-to indicator
function ThreadInputArea({
  rootMessageId,
  level,
  replyingTo,
  onClearReplyingTo,
}: {
  rootMessageId: string;
  level: ThreadLevel;
  replyingTo: { messageId: string; senderName: string } | null;
  onClearReplyingTo: () => void;
}) {
  const { t } = useTranslation("thread");
  const sendReply = useSendThreadReply(rootMessageId, level);

  const handleSubmit = async (content: string) => {
    if (!content.trim()) return;
    await sendReply.mutateAsync({ content });
  };

  return (
    <div className="border-t p-3 bg-white">
      {/* Replying-to indicator */}
      {replyingTo && (
        <div className="flex items-center gap-2 mb-2 px-2 py-1 bg-slate-100 rounded text-sm">
          <span className="text-muted-foreground">{t("replyingTo")}</span>
          <span className="font-medium">@{replyingTo.senderName}</span>
          <button
            onClick={onClearReplyingTo}
            className="ml-auto text-muted-foreground hover:text-slate-700"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <RichTextEditor
        onSubmit={handleSubmit}
        disabled={sendReply.isPending}
        placeholder={t("inputPlaceholder")}
        compact
      />
    </div>
  );
}
