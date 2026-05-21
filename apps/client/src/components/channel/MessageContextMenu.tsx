import { useTranslation } from "react-i18next";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { MessageSquare, Link, Copy, Pin, Trash2, Pencil } from "lucide-react";
import imApi from "@/services/api/im";
import type { Message } from "@/types/im";

interface MessageContextMenuProps {
  children: React.ReactNode;
  message: Message;
  isOwnMessage: boolean;
  canDelete?: boolean;
  onReplyInThread?: () => void;
  onCopyMessage?: () => void;
  onCopyLink?: () => void;
  onPin?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function MessageContextMenu({
  children,
  message,
  isOwnMessage,
  canDelete,
  onReplyInThread,
  onCopyMessage,
  onCopyLink,
  onPin,
  onEdit,
  onDelete,
}: MessageContextMenuProps) {
  const { t } = useTranslation("message");
  const queryClient = useQueryClient();

  const handleCopyMessage = () => {
    void copyMessageContent(message, queryClient, onCopyMessage);
  };

  const handleCopyLink = () => {
    // Generate message link - you can customize this format
    const link = `${window.location.origin}${window.location.pathname}?message=${message.id}`;
    navigator.clipboard.writeText(link);
    onCopyLink?.();
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {/* Reply actions */}
        {onReplyInThread && (
          <ContextMenuItem onClick={onReplyInThread}>
            <MessageSquare className="mr-2 h-4 w-4" />
            {t("replyInThread")}
            <ContextMenuShortcut>T</ContextMenuShortcut>
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        {/* Copy actions */}
        <ContextMenuItem onClick={handleCopyLink}>
          <Link className="mr-2 h-4 w-4" />
          {t("copyLink")}
          <ContextMenuShortcut>L</ContextMenuShortcut>
        </ContextMenuItem>
        {message.content && (
          <ContextMenuItem onClick={handleCopyMessage}>
            <Copy className="mr-2 h-4 w-4" />
            {t("copyMessage")}
            <ContextMenuShortcut>⌘C</ContextMenuShortcut>
          </ContextMenuItem>
        )}

        <ContextMenuSeparator />

        {/* Pin action */}
        {onPin && (
          <ContextMenuItem onClick={onPin}>
            <Pin className="mr-2 h-4 w-4" />
            {message.isPinned ? t("unpinMessage") : t("pinMessage")}
          </ContextMenuItem>
        )}

        {/* Edit - only for own messages with edit handler */}
        {isOwnMessage && onEdit && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              {t("edit")}
              <ContextMenuShortcut>E</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
        {/* Delete - for own messages or admins/owners, only if handler is wired */}
        {(isOwnMessage || canDelete) && onDelete && (
          <>
            {!isOwnMessage && <ContextMenuSeparator />}
            <ContextMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t("deleteMessage")}
              <ContextMenuShortcut>Del</ContextMenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function shouldFetchFullContentForCopy(message: Message): boolean {
  return (
    message.type === "long_text" &&
    (message.isTruncated === true ||
      (typeof message.fullContentLength === "number" &&
        message.fullContentLength > message.content.length))
  );
}

async function resolveMessageCopyContent(
  message: Message,
  queryClient: QueryClient,
): Promise<string> {
  if (!shouldFetchFullContentForCopy(message)) return message.content;

  try {
    const fullContent = await queryClient.ensureQueryData({
      queryKey: ["message-full-content", message.id],
      queryFn: () => imApi.messages.getFullContent(message.id),
      staleTime: Infinity,
    });
    return fullContent.content || message.content;
  } catch (error) {
    console.warn("Failed to load full message content for copy", error);
    return message.content;
  }
}

async function copyMessageContent(
  message: Message,
  queryClient: QueryClient,
  onCopyMessage?: () => void,
) {
  if (!message.content) return;

  const clipboard = navigator.clipboard;
  if (!clipboard?.writeText) {
    console.warn("Clipboard API unavailable");
    return;
  }

  try {
    const content = await resolveMessageCopyContent(message, queryClient);
    await clipboard.writeText(content);
    onCopyMessage?.();
  } catch (error) {
    console.warn("Failed to copy message content", error);
  }
}
