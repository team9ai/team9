import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, AlertCircle, RotateCcw, X } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { MessageContent } from "./MessageContent";
import { MessageAttachments } from "./MessageAttachments";
import { MessageContextMenu } from "./MessageContextMenu";
import { MessageHoverToolbar } from "./MessageHoverToolbar";
import { MessageReactions } from "./MessageReactions";
import { MessageTitle } from "./MessageTitle";
import { MessageProperties } from "./properties/MessageProperties";
import { ThreadReplyIndicator } from "./ThreadReplyIndicator";
import { ThinkingBlock } from "./ThinkingBlock";
import { TrackingCard } from "./TrackingCard";
import { TrackingEventItem } from "./TrackingEventItem";
import { AgentTypeBadge } from "@/components/ui/agent-type-badge";
import {
  formatMessageTime,
  formatEditedTime,
  parseApiDate,
} from "@/lib/date-utils";
import { formatAbsoluteTooltip } from "@/lib/date-format";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RichTextEditor } from "./editor";
import { useFullContent } from "@/hooks/useMessages";
import { getAgentMeta } from "@/lib/agent-events";
import { cn } from "@/lib/utils";
import { usePropertyDefinitions } from "@/hooks/usePropertyDefinitions";
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
  /** Whether current user can delete this message (admin/owner) */
  canDelete?: boolean;
  /** Context menu handlers */
  onReplyInThread?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPin?: () => void;
  /** Retry sending a failed message */
  onRetry?: () => void;
  /** Remove a failed message from the list */
  onRemoveFailed?: () => void;
  /** Whether this message is currently being edited */
  isEditing?: boolean;
  /** Whether the edit save is in progress */
  isEditSaving?: boolean;
  /** Callback when edit is saved with new content */
  onEditSave?: (content: string) => Promise<void>;
  /** Callback when edit is cancelled */
  onEditCancel?: () => void;
  /** Reaction handlers */
  onAddReaction?: (emoji: string) => void;
  onRemoveReaction?: (emoji: string) => void;
  /**
   * Whether this channel supports structured message properties.
   * Only `public` and `private` channels do (spec 2026-04-11). When false,
   * the hover toolbar's Properties button is hidden.
   */
  supportsProperties?: boolean;
}

function getThinkingMetadata(
  metadata: Message["metadata"],
): { thinking?: string } | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const thinking = metadata["thinking"];
  return typeof thinking === "string" ? { thinking } : undefined;
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
  canDelete,
  onReplyInThread,
  onEdit,
  onDelete,
  onPin,
  onRetry,
  onRemoveFailed,
  onAddReaction,
  onRemoveReaction,
  isEditing = false,
  isEditSaving = false,
  onEditSave,
  onEditCancel,
  supportsProperties = false,
}: MessageItemProps) {
  const { t } = useTranslation(["thread", "message"]);
  const thinkingMetadata = getThinkingMetadata(message.metadata);
  const [isHovered, setIsHovered] = useState(false);
  const [propertySelectorOpen, setPropertySelectorOpen] = useState(false);
  const isSystemMessage = message.type === "system";
  const isOwnMessage = currentUserId === message.senderId;
  const isSending = message.sendStatus === "sending";
  const isFailed = message.sendStatus === "failed";
  const { data: propertyDefinitions } = usePropertyDefinitions(
    message.channelId,
  );

  // Fetch full content for long_text messages when entering edit mode
  const isLongText = message.type === "long_text" || message.isTruncated;
  const needsFullContent = isEditing && isLongText;
  const {
    data: fullContentData,
    isLoading: isLoadingFullContent,
    isError: isFullContentError,
  } = useFullContent(message.id, needsFullContent);
  const editHtml =
    needsFullContent && fullContentData
      ? fullContentData.content
      : needsFullContent
        ? undefined // Don't fall back to truncated content
        : message.content;

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
          onProperties={
            supportsProperties ? () => setPropertySelectorOpen(true) : undefined
          }
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
        <div className="flex items-baseline gap-2 mb-1 flex-wrap">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-semibold text-sm">{senderName}</span>
            <AgentTypeBadge agentType={message.sender?.agentType} />
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground cursor-default">
                {formatMessageTime(parseApiDate(message.createdAt))}
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="bg-foreground text-background border-foreground text-xs font-medium"
            >
              {formatAbsoluteTooltip(parseApiDate(message.createdAt))}
            </TooltipContent>
          </Tooltip>
          {message.isEdited && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-muted-foreground cursor-default">
                  {t("message:editedAt", {
                    time: formatEditedTime(parseApiDate(message.updatedAt)),
                  })}
                </span>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                className="bg-foreground text-background border-foreground text-xs font-medium"
              >
                {formatAbsoluteTooltip(parseApiDate(message.updatedAt))}
              </TooltipContent>
            </Tooltip>
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
        {thinkingMetadata?.thinking && (
          <ThinkingBlock
            content={thinkingMetadata.thinking}
            isStreaming={false}
          />
        )}
        <MessageTitle
          title={
            message.properties?.title != null
              ? String(message.properties.title)
              : undefined
          }
          messageId={message.id}
        />
        {isEditing ? (
          <div className="w-full">
            {needsFullContent && isLoadingFullContent ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                <span>{t("message:loadingFullContent")}</span>
              </div>
            ) : needsFullContent && (isFullContentError || !editHtml) ? (
              <div className="flex items-center gap-2 py-2 text-sm text-destructive">
                <AlertCircle size={14} />
                <span>{t("message:loadFullContentFailed")}</span>
              </div>
            ) : (
              <RichTextEditor
                channelId={message.channelId}
                compact
                initialHtml={editHtml}
                clearOnSubmit={false}
                disabled={isEditSaving}
                submitLabel={t("message:editSave")}
                onSubmit={async (content) => {
                  await onEditSave?.(content);
                }}
                onCancel={onEditCancel}
                placeholder={t("message:edit")}
              />
            )}
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={() => onEditCancel?.()}
                className="text-xs text-muted-foreground hover:text-foreground"
                disabled={isEditSaving}
              >
                {t("message:editCancel")}
              </button>
              {!isEditSaving && (
                <span className="text-xs text-muted-foreground">
                  {t("message:editHint")}
                </span>
              )}
            </div>
          </div>
        ) : (
          <>
            {hasContent && (
              <div className="channel-message-content">
                <MessageContent
                  content={message.content}
                  className="text-sm whitespace-pre-wrap break-words"
                  message={message}
                />
              </div>
            )}
          </>
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
        {supportsProperties &&
          propertyDefinitions &&
          propertyDefinitions.length > 0 && (
            <MessageProperties
              message={message}
              channelId={message.channelId}
              definitions={propertyDefinitions}
              canEdit={true}
              selectorOpen={propertySelectorOpen}
              onSelectorOpenChange={setPropertySelectorOpen}
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
        {showReplyCount && (message.replyCount || 0) > 0 && (
          <ThreadReplyIndicator
            replyCount={message.replyCount || 0}
            lastRepliers={message.lastRepliers}
            lastReplyAt={message.lastReplyAt}
            unreadCount={unreadSubReplyCount}
            onClick={onReplyCountClick}
          />
        )}
      </div>
    </div>
  );

  // Root messages don't have context menu
  if (isRootMessage) {
    return content;
  }

  // Disable edit/pin/delete for messages still sending or failed (temp IDs)
  const isPersisted = !isSending && !isFailed;

  return (
    <MessageContextMenu
      message={message}
      isOwnMessage={isOwnMessage}
      canDelete={canDelete}
      onReplyInThread={onReplyInThread}
      onEdit={isPersisted && isOwnMessage ? onEdit : undefined}
      onDelete={
        isPersisted && (isOwnMessage || canDelete) ? onDelete : undefined
      }
      onPin={isPersisted ? onPin : undefined}
    >
      {content}
    </MessageContextMenu>
  );
}
