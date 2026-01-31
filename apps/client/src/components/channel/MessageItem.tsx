import { useTranslation } from "react-i18next";
import {
  MessageSquare,
  Loader2,
  AlertCircle,
  RotateCcw,
  X,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessageContent } from "./MessageContent";
import { MessageAttachments } from "./MessageAttachments";
import { MessageContextMenu } from "./MessageContextMenu";
import { formatMessageTime } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import type { Message } from "@/types/im";

export interface MessageItemProps {
  message: Message;
  currentUserId?: string;
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
  onReply?: () => void;
  onReplyInThread?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPin?: () => void;
  /** Retry sending a failed message */
  onRetry?: () => void;
  /** Remove a failed message from the list */
  onRemoveFailed?: () => void;
}

export function MessageItem({
  message,
  currentUserId,
  compact = false,
  indent = false,
  isRootMessage = false,
  showReplyCount = false,
  onReplyCountClick,
  unreadSubReplyCount,
  isHighlighted = false,
  onReply,
  onReplyInThread,
  onEdit,
  onDelete,
  onPin,
  onRetry,
  onRemoveFailed,
}: MessageItemProps) {
  const { t } = useTranslation(["thread", "message"]);
  const isOwnMessage = currentUserId === message.senderId;
  const isSending = message.sendStatus === "sending";
  const isFailed = message.sendStatus === "failed";

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

  const initials =
    message.sender?.displayName?.[0] || message.sender?.username?.[0] || "?";
  const senderName =
    message.sender?.displayName || message.sender?.username || "Unknown User";

  const hasContent = Boolean(message.content?.trim());
  const hasAttachments = message.attachments && message.attachments.length > 0;

  // Reply count indicator component
  const ReplyCountIndicator = () => {
    if (!showReplyCount) return null;

    const replyCount = message.replyCount || 0;
    if (replyCount === 0) return null;

    return (
      <button
        onClick={onReplyCountClick}
        className="flex items-center gap-1 text-xs text-info hover:text-info mt-1"
      >
        <MessageSquare size={14} />
        <span>{t("repliesCount", { count: replyCount })}</span>
        {/* Unread sub-reply badge */}
        {unreadSubReplyCount != null && unreadSubReplyCount > 0 && (
          <span className="ml-1 px-1.5 py-0.5 bg-destructive text-primary-foreground text-[10px] font-medium rounded-full min-w-4.5 text-center">
            {unreadSubReplyCount > 99 ? "99+" : unreadSubReplyCount}
          </span>
        )}
      </button>
    );
  };

  const content = (
    <div
      id={`message-${message.id}`}
      className={cn(
        "flex hover:bg-muted/50 rounded transition-colors duration-300",
        compact ? "gap-2 py-2 px-1" : "gap-3 px-2 py-1",
        indent && "ml-6",
        isHighlighted &&
          "bg-warning/20 dark:bg-warning/30 ring-2 ring-warning dark:ring-warning",
        isSending && "opacity-70",
        isFailed && "bg-destructive/10 dark:bg-destructive/10",
      )}
    >
      <Avatar className={cn("shrink-0", compact ? "w-8 h-8" : "w-9 h-9")}>
        {message.sender?.avatarUrl && (
          <AvatarImage src={message.sender.avatarUrl} alt={senderName} />
        )}
        {message.sender?.userType === "bot" && !message.sender?.avatarUrl && (
          <AvatarImage src="/bot.webp" alt={senderName} />
        )}
        <AvatarFallback
          className={cn(
            "bg-primary text-primary-foreground",
            compact ? "text-xs" : "text-sm",
          )}
        >
          {initials.toUpperCase()}
        </AvatarFallback>
      </Avatar>

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
        {hasContent && (
          <div className="w-fit max-w-full">
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
        <ReplyCountIndicator />
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
      onReply={onReply}
      onReplyInThread={onReplyInThread}
      onEdit={isOwnMessage ? onEdit : undefined}
      onDelete={isOwnMessage ? onDelete : undefined}
      onPin={onPin}
    >
      {content}
    </MessageContextMenu>
  );
}
