import { useState } from "react";
import {
  X,
  ChevronDown,
  ChevronUp,
  MessageSquare,
  Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  useThreadPanel,
  useSendThreadReply,
  useSubReplies,
} from "@/hooks/useThread";
import { useCurrentUser } from "@/hooks/useAuth";
import { MessageContent } from "./MessageContent";
import { MessageAttachments } from "./MessageAttachments";
import { MessageContextMenu } from "./MessageContextMenu";
import { RichTextEditor } from "./editor";
import { formatMessageTime } from "@/lib/date-utils";
import type { Message, ThreadReply } from "@/types/im";
import { cn } from "@/lib/utils";

export function ThreadPanel() {
  const { t } = useTranslation("thread");
  const {
    isOpen,
    rootMessageId,
    threadData,
    isLoading,
    replyingTo,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    closeThread,
    setReplyingTo,
    clearReplyingTo,
  } = useThreadPanel();
  const { data: currentUser } = useCurrentUser();

  if (!isOpen || !rootMessageId) {
    return null;
  }

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

          {/* Replies */}
          <ScrollArea className="flex-1 min-h-0">
            <div className="px-4 py-2 space-y-1">
              {threadData.replies.map((reply: ThreadReply) => (
                <ThreadReplyItem
                  key={reply.id}
                  reply={reply}
                  currentUserId={currentUser?.id}
                  onReplyTo={(messageId: string, senderName: string) =>
                    setReplyingTo({ messageId, senderName })
                  }
                />
              ))}

              {/* Load more button */}
              {hasNextPage && (
                <div className="flex justify-center py-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="text-blue-600 hover:text-blue-700"
                  >
                    {isFetchingNextPage ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {t("loadingMore")}
                      </>
                    ) : (
                      t("loadMore")
                    )}
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>

          {/* Input */}
          <ThreadInputArea
            rootMessageId={rootMessageId}
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
}: {
  message: Message;
  currentUserId?: string;
  isRootMessage?: boolean;
  onReplyTo?: (messageId: string, senderName: string) => void;
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

  const handleReplyInThread = () => {
    if (onReplyTo && !isRootMessage) {
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

// Thread reply item with collapsible sub-replies
function ThreadReplyItem({
  reply,
  currentUserId,
  onReplyTo,
}: {
  reply: ThreadReply;
  currentUserId?: string;
  onReplyTo: (messageId: string, senderName: string) => void;
}) {
  const { t } = useTranslation("thread");
  const [isExpanded, setIsExpanded] = useState(false);
  const {
    data: subRepliesData,
    isLoading: isLoadingSubReplies,
    hasNextPage: hasMoreSubRepliesPages,
    isFetchingNextPage: isFetchingMoreSubReplies,
    fetchNextPage: fetchMoreSubReplies,
  } = useSubReplies(reply.id, isExpanded && reply.subReplyCount > 2);

  const hasMoreSubReplies = reply.subReplyCount > 2;

  // Merge all pages of sub-replies when expanded
  const allSubReplies = subRepliesData?.pages?.flatMap((page) => page.replies);
  const displayedSubReplies = isExpanded
    ? allSubReplies || reply.subReplies
    : reply.subReplies;

  return (
    <div>
      {/* First-level reply */}
      <ThreadMessage
        message={reply}
        currentUserId={currentUserId}
        onReplyTo={onReplyTo}
      />

      {/* Sub-replies (second-level) */}
      {displayedSubReplies.length > 0 && (
        <div className="border-l-2 border-slate-200 ml-4">
          {displayedSubReplies.map((subReply: Message) => (
            <ThreadMessage
              key={subReply.id}
              message={subReply}
              currentUserId={currentUserId}
              indent
            />
          ))}

          {/* Load more sub-replies button */}
          {isExpanded && hasMoreSubRepliesPages && (
            <button
              onClick={() => fetchMoreSubReplies()}
              className="ml-6 my-2 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
              disabled={isFetchingMoreSubReplies}
            >
              {isFetchingMoreSubReplies ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  {t("loadingMore")}
                </>
              ) : (
                t("loadMore")
              )}
            </button>
          )}
        </div>
      )}

      {/* Expand/collapse button for more sub-replies */}
      {hasMoreSubReplies && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="ml-4 mt-1 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
          disabled={isLoadingSubReplies}
        >
          {isExpanded ? (
            <>
              <ChevronUp size={14} />
              {t("hideReplies")}
            </>
          ) : (
            <>
              <ChevronDown size={14} />
              {t("showMoreReplies", { count: reply.subReplyCount - 2 })}
            </>
          )}
        </button>
      )}
    </div>
  );
}

// Thread input area with replying-to indicator
function ThreadInputArea({
  rootMessageId,
  replyingTo,
  onClearReplyingTo,
}: {
  rootMessageId: string;
  replyingTo: { messageId: string; senderName: string } | null;
  onClearReplyingTo: () => void;
}) {
  const { t } = useTranslation("thread");
  const sendReply = useSendThreadReply(rootMessageId);

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
