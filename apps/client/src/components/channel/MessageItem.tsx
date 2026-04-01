import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, AlertCircle, RotateCcw, X } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { MessageContent } from "./MessageContent";
import { MessageAttachments } from "./MessageAttachments";
import { MessageContextMenu } from "./MessageContextMenu";
import { MessageHoverToolbar } from "./MessageHoverToolbar";
import { MessageReactions } from "./MessageReactions";
import { ThreadReplyIndicator } from "./ThreadReplyIndicator";
import { ThinkingBlock } from "./ThinkingBlock";
import { TrackingCard } from "./TrackingCard";
import { TrackingEventItem } from "./TrackingEventItem";
import { formatMessageTime } from "@/lib/date-utils";
import { getAgentMeta } from "@/lib/agent-events";
import { cn } from "@/lib/utils";
import type { Message } from "@/types/im";

export interface MessageItemProps {
  message: Message;
  currentUserId?: string;
  /** Previous message in the list — used for agent event grouping */
  prevMessage?: Message;
  /** Compact mode for thread panel - smaller avatar and spacing */
  compact?: boolean;
  /** Indent for nested replies */
  indent?: boolean;
  /** Root message doesn't show context menu */
  isRootMessage?: boolean;
  /** Show reply count indicator */
  showReplyCount?: boolean;
  /** Callback when reply count is clicked */
  onReplyCountClick?: () => void;
  /** Unread sub-reply count badge */
  unreadSubReplyCount?: number;
  /** Highlight this message (e.g., from deep link navigation) */
  isHighlighted?: boolean;
  /** Context menu handlers */
  onReplyInThread?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPin?: () => void;
  /** Retry sending a failed message */
  onRetry?: () => void;
  /** Remove a failed message from the list */
  onRemoveFailed?: () => void;
  /** Reaction handlers */
  onAddReaction?: (emoji: string) => void;
  onRemoveReaction?: (emoji: string) => void;
}

export function MessageItem({
  message,
  currentUserId,
  prevMessage,
  compact = false,
  indent = false,
  isRootMessage = false,
  showReplyCount = false,
  onReplyCountClick,
  unreadSubReplyCount,
  isHighlighted = false,
  onReplyInThread,
  onEdit,
  onDelete,
  onPin,
  onRetry,
  onRemoveFailed,
  onAddReaction,
  onRemoveReaction,
}: MessageItemProps) {
  const { t } = useTranslation(["thread", "message"]);
  const [isHovered, setIsHovered] = useState(false);
  const isSystemMessage = message.type === "system";
  const isOwnMessage = currentUserId === message.senderId;
  const isSending = message.sendStatus === "sending";
  const isFailed = message.sendStatus === "failed";

  // Tracking message display (inline card)
  const isTrackingMessage = message.type === "tracking";
  if (isTrackingMessage) {
    return (
      <div id={`message-${message.id}`} className="py-2 px-2">
        <TrackingCard message={message} />
      </div>
    );
  }

  // Agent event message display (no avatar, compact, grouped)
  const agentMeta = getAgentMeta(message);
  if (agentMeta) {
    const prevIsAgentEvent = prevMessage ? !!getAgentMeta(prevMessage) : false;
    const isFirstInGroup = !prevIsAgentEvent;

    return (
      <div
        id={`message-${message.id}`}
        className={cn(
          "ml-4 border-l-2 border-emerald-500/15 bg-emerald-500/[0.03] rounded-r-md pr-4",
          isFirstInGroup ? "mt-1 pt-1.5" : "",
          "pb-0.5",
        )}
        style={{ paddingLeft: "13px" }}
      >
        <TrackingEventItem
          metadata={agentMeta}
          content={message.content ?? ""}
          collapsible={
            agentMeta.agentEventType === "tool_result" ||
            agentMeta.agentEventType === "thinking"
          }
        />
      </div>
    );
  }

  // System message display (centered, no avatar, gray text)
  if (isSystemMessage) {
    return (
      <div
        id={`message-${message.id}`}
        className="flex justify-center py-2 px-2"
      >
        <span className="text-xs text-muted-foreground">{message.content}</span>
      </div>
    );
  }

  // Deleted message display
  if (message.isDeleted) {
    return (
      <div
        className={cn(
          "flex opacity-50",
          compact ? "gap-2 py-1" : "gap-3",
          indent && "ml-6",
        )}
      >
        <div className={compact ? "w-8 h-8" : "w-9 h-9"} />
        <div className="flex-1">
          <p className="text-sm text-muted-foreground italic">
            This message was deleted
          </p>
        </div>
      </div>
    );
  }

  const senderName =
    message.sender?.displayName || message.sender?.username || "Unknown User";

  const hasContent = Boolean(message.content?.trim());
  const hasAttachments = message.attachments && message.attachments.length > 0;

  const showToolbar = isHovered && !isSending && !isFailed && !isRootMessage;
  const hasReactions = message.reactions && message.reactions.length > 0;

  // Toggle reaction: remove if already reacted, add if not
  const handleReactionToggle = (emoji: string) => {
    const hasReacted = message.reactions?.some(
      (r) => r.userId === currentUserId && r.emoji === emoji,
    );
    if (hasReacted) {
      onRemoveReaction?.(emoji);
    } else {
      onAddReaction?.(emoji);
    }
  };

  const content = (
    <div
      id={`message-${message.id}`}
      className={cn(
        "relative flex hover:bg-muted/50 rounded transition-colors duration-300",
        compact ? "gap-2 py-2 px-1" : "gap-3 px-2 py-1",
        indent && "ml-6",
        isHighlighted &&
          "bg-warning/20 dark:bg-warning/30 ring-2 ring-warning dark:ring-warning",
        isSending && "opacity-70",
        isFailed && "bg-destructive/10 dark:bg-destructive/10",
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {showToolbar && onAddReaction && (
        <MessageHoverToolbar
          onReaction={handleReactionToggle}
          onReplyInThread={onReplyInThread}
        />
      )}
      <UserAvatar
        userId={message.sender?.id ?? message.senderId ?? undefined}
        name={message.sender?.displayName ?? senderName}
        username={message.sender?.username}
        avatarUrl={message.sender?.avatarUrl}
        isBot={message.sender?.userType === "bot"}
        className={cn("shrink-0", compact ? "w-8 h-8" : "w-9 h-9")}
        fallbackClassName={compact ? "text-xs" : "text-sm"}
      />

      <div className="flex flex-col items-start flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-semibold text-sm">{senderName}</span>
          <span className="text-xs text-muted-foreground">
            {formatMessageTime(new Date(message.createdAt))}
          </span>
          {message.isEdited && (
            <span className="text-xs text-muted-foreground">(edited)</span>
          )}
          {isSending && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" />
              {t("message:sending")}
            </span>
          )}
          {isFailed && (
            <span className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle size={12} />
              {t("message:sendFailed")}
            </span>
          )}
        </div>
        {(message.metadata as any)?.thinking && (
          <ThinkingBlock
            content={(message.metadata as any).thinking}
            isStreaming={false}
          />
        )}
        {hasContent && (
          <div className="channel-message-content">
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
        {isFailed && (
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={onRetry}
              className="flex items-center gap-1 text-xs text-info hover:text-info hover:underline"
            >
              <RotateCcw size={12} />
              {t("message:retry")}
            </button>
            <button
              onClick={onRemoveFailed}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
            >
              <X size={12} />
              {t("message:remove")}
            </button>
          </div>
        )}
        {showReplyCount && (message.replyCount || 0) > 0 && (
          <ThreadReplyIndicator
            replyCount={message.replyCount || 0}
            lastRepliers={message.lastRepliers}
            lastReplyAt={message.lastReplyAt}
            unreadCount={unreadSubReplyCount}
            onClick={onReplyCountClick}
          />
        )}
        {hasReactions && onAddReaction && onRemoveReaction && (
          <MessageReactions
            reactions={message.reactions!}
            currentUserId={currentUserId}
            channelId={message.channelId}
            onAddReaction={onAddReaction}
            onRemoveReaction={onRemoveReaction}
          />
        )}
      </div>
    </div>
  );

  // Root messages don't have context menu
  if (isRootMessage) {
    return content;
  }

  return (
    <MessageContextMenu
      message={message}
      isOwnMessage={isOwnMessage}
      onReplyInThread={onReplyInThread}
      onEdit={isOwnMessage ? onEdit : undefined}
      onDelete={isOwnMessage ? onDelete : undefined}
      onPin={onPin}
    >
      {content}
    </MessageContextMenu>
  );
}
