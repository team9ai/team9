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
  Link,
  Copy,
  Pin,
  Trash2,
  Pencil,
  Forward,
  CheckSquare,
} from "lucide-react";
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
  /** Called when Forward menu item is clicked. Only shown when forwardable is true. */
  onForward?: () => void;
  /** Called when Select menu item is clicked. Only shown when forwardable is true. */
  onSelect?: () => void;
  /** Controls visibility of Forward + Select menu items. */
  forwardable?: boolean;
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
  onForward,
  onSelect,
  forwardable,
}: MessageContextMenuProps) {
  const { t } = useTranslation("message");
  const { t: tChannel } = useTranslation("channel");

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
        {onReplyInThread && (
          <ContextMenuItem onClick={onReplyInThread}>
            <MessageSquare className="mr-2 h-4 w-4" />
            {t("replyInThread")}
            <ContextMenuShortcut>T</ContextMenuShortcut>
          </ContextMenuItem>
        )}

        {/* Forward / Select actions */}
        {forwardable && onForward && (
          <ContextMenuItem onClick={onForward}>
            <Forward className="mr-2 h-4 w-4" />
            {tChannel("forward.contextMenu.forward")}
            <ContextMenuShortcut>F</ContextMenuShortcut>
          </ContextMenuItem>
        )}
        {forwardable && onSelect && (
          <ContextMenuItem onClick={onSelect}>
            <CheckSquare className="mr-2 h-4 w-4" />
            {tChannel("forward.contextMenu.select")}
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
