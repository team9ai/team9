import { useTranslation } from "react-i18next";
import { MessageSquare } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
  /** Context menu handlers */
  onReply?: () => void;
  onReplyInThread?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPin?: () => void;
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
  onReply,
  onReplyInThread,
  onEdit,
  onDelete,
  onPin,
}: MessageItemProps) {
  const { t } = useTranslation("thread");
  const isOwnMessage = currentUserId === message.senderId;

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
        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 mt-1"
      >
        <MessageSquare size={14} />
        <span>{t("repliesCount", { count: replyCount })}</span>
        {/* Unread sub-reply badge */}
        {unreadSubReplyCount && unreadSubReplyCount > 0 && (
          <span className="ml-1 px-1.5 py-0.5 bg-red-500 text-white text-[10px] font-medium rounded-full min-w-4.5 text-center">
            {unreadSubReplyCount > 99 ? "99+" : unreadSubReplyCount}
          </span>
        )}
      </button>
    );
  };

  const content = (
    <div
      className={cn(
        "flex hover:bg-muted/50 rounded",
        compact ? "gap-2 py-2 px-1" : "gap-3 px-2 py-1",
        indent && "ml-6",
      )}
    >
      <Avatar className={cn("shrink-0", compact ? "w-8 h-8" : "w-9 h-9")}>
        <AvatarFallback
          className={cn(
            "bg-linear-to-br from-purple-400 to-purple-600 text-white",
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
