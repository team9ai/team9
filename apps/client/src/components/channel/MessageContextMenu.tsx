import { useTranslation } from "react-i18next";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  MessageSquare,
  Reply,
  Link,
  Copy,
  Pin,
  Trash2,
  Pencil,
} from "lucide-react";
import type { Message } from "@/types/im";

interface MessageContextMenuProps {
  children: React.ReactNode;
  message: Message;
  isOwnMessage: boolean;
  onReply?: () => void;
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
  onReply,
  onReplyInThread,
  onCopyMessage,
  onCopyLink,
  onPin,
  onEdit,
  onDelete,
}: MessageContextMenuProps) {
  const { t } = useTranslation("message");

  const handleCopyMessage = () => {
    if (message.content) {
      navigator.clipboard.writeText(message.content);
      onCopyMessage?.();
    }
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
        <ContextMenuItem onClick={onReply}>
          <Reply className="mr-2 h-4 w-4" />
          {t("reply")}
          <ContextMenuShortcut>R</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={onReplyInThread}>
          <MessageSquare className="mr-2 h-4 w-4" />
          {t("replyInThread")}
          <ContextMenuShortcut>T</ContextMenuShortcut>
        </ContextMenuItem>

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
        <ContextMenuItem onClick={onPin}>
          <Pin className="mr-2 h-4 w-4" />
          {message.isPinned ? t("unpinMessage") : t("pinMessage")}
        </ContextMenuItem>

        {/* Edit and Delete - only for own messages */}
        {isOwnMessage && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              {t("edit")}
              <ContextMenuShortcut>E</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem
              onClick={onDelete}
              className="text-red-600 focus:text-red-600 focus:bg-red-50"
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
