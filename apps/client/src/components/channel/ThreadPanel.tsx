import { useRef, useCallback, useEffect } from "react";
import { X, MessageSquare, Loader2, ArrowDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  useThreadPanelForLevel,
  useSendThreadReply,
  useThreadStore,
  type ThreadLevel,
} from "@/hooks/useThread";
import { useCurrentUser } from "@/hooks/useAuth";
import { MessageItem } from "./MessageItem";
import { MessageInput } from "./MessageInput";
import type { ThreadReply } from "@/types/im";

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
    clearReplyingTo,
  } = useThreadPanelForLevel(level, rootMessageId);
  const { data: currentUser } = useCurrentUser();
  const sendReply = useSendThreadReply(rootMessageId, level);

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

  // Handle send reply
  const handleSendReply = async (content: string) => {
    if (!content.trim()) return;
    await sendReply.mutateAsync({ content });
  };

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
            <MessageItem
              message={threadData.rootMessage}
              currentUserId={currentUser?.id}
              compact
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

          {/* Input - using shared MessageInput component */}
          <MessageInput
            compact
            replyingTo={replyingTo}
            onClearReplyingTo={clearReplyingTo}
            onSend={handleSendReply}
            disabled={sendReply.isPending}
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

// Thread reply item - uses shared MessageItem with sub-reply count
function ThreadReplyItem({
  reply,
  currentUserId,
  canOpenNestedThread = false,
  onOpenNestedThread,
}: {
  reply: ThreadReply;
  currentUserId?: string;
  canOpenNestedThread?: boolean;
  onOpenNestedThread?: (messageId: string) => void;
}) {
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

  // Handle reply in thread action from context menu
  const handleReplyInThread =
    canOpenNestedThread && onOpenNestedThread
      ? () => onOpenNestedThread(reply.id)
      : undefined;

  return (
    <div>
      {/* First-level reply using shared MessageItem */}
      <MessageItem
        message={reply}
        currentUserId={currentUserId}
        compact
        showReplyCount={canOpenNestedThread && reply.subReplyCount > 0}
        onReplyCountClick={handleOpenInNewPanel}
        unreadSubReplyCount={unreadCount}
        onReplyInThread={handleReplyInThread}
      />
    </div>
  );
}
