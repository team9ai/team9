import { Hash, AtSign, MessageSquare, Reply } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { formatMessageTime } from "@/lib/date-utils";
import type {
  Notification,
  NotificationType,
} from "@/stores/useNotificationStore";
interface ActivityItemProps {
  notification: Notification;
  isSelected?: boolean;
  onClick?: () => void;
}

function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case "mention":
    case "channel_mention":
    case "everyone_mention":
    case "here_mention":
      return AtSign;
    case "reply":
    case "thread_reply":
      return Reply;
    default:
      return MessageSquare;
  }
}

function getSourceContext(
  notification: Notification,
  t: (key: string, options?: Record<string, string>) => string,
): string {
  const { type, title } = notification;

  // Try to extract channel name from title
  // Title formats like "username mentioned you in #channelName"
  const channelMatch = title.match(/#([^\s]+)/);
  const channelName = channelMatch ? channelMatch[1] : "";

  switch (type) {
    case "mention":
      return channelName
        ? t("mentionInChannel", { channel: channelName })
        : t("mentionLabel");
    case "channel_mention":
      return channelName
        ? t("channelMentionInChannel", { channel: channelName })
        : t("channelMentionLabel");
    case "everyone_mention":
      return channelName
        ? t("everyoneMentionInChannel", { channel: channelName })
        : t("everyoneMentionLabel");
    case "here_mention":
      return channelName
        ? t("mentionInChannel", { channel: channelName })
        : t("hereMentionLabel");
    case "reply":
      return channelName
        ? t("replyInChannel", { channel: channelName })
        : t("replyLabel");
    case "thread_reply":
      return channelName
        ? t("threadReplyInChannel", { channel: channelName })
        : t("threadReplyLabel");
    default:
      return t("activityLabel");
  }
}

export function ActivityItem({
  notification,
  isSelected = false,
  onClick,
}: ActivityItemProps) {
  const { t } = useTranslation("navigation");
  const Icon = getNotificationIcon(notification.type);
  const sourceContext = getSourceContext(notification, t);
  const timeStr = formatMessageTime(new Date(notification.createdAt));

  const actorName =
    notification.actor?.displayName || notification.actor?.username || "System";
  const actorInitial =
    notification.actor?.displayName?.[0] ||
    notification.actor?.username?.[0]?.toUpperCase() ||
    "S";

  return (
    <div
      className={cn(
        "px-2 py-2 rounded-md cursor-pointer transition-colors",
        "hover:bg-white/10",
        isSelected && "bg-white/15",
        !notification.isRead && "border-l-2 border-purple-400",
      )}
      onClick={onClick}
    >
      {/* Source context header */}
      <div className="flex items-center gap-1.5 mb-1.5">
        <Hash size={12} className="text-white/50" />
        <span className="text-xs text-white/70 truncate flex-1">
          {sourceContext}
        </span>
        <span className="text-xs text-white/50">{timeStr}</span>
      </div>

      {/* User info and preview */}
      <div className="flex items-start gap-2">
        <Avatar className="w-8 h-8 shrink-0">
          {notification.actor?.avatarUrl && (
            <AvatarImage src={notification.actor.avatarUrl} alt={actorName} />
          )}
          <AvatarFallback className="bg-purple-500 text-white text-xs">
            {actorInitial}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-white truncate">
              {actorName}
            </span>
            <Icon size={12} className="text-white/50 shrink-0" />
          </div>
          {notification.body && (
            <p className="text-xs text-white/60 mt-0.5 line-clamp-2">
              {notification.body}
            </p>
          )}
        </div>
        {!notification.isRead && (
          <div className="w-2 h-2 rounded-full bg-purple-400 shrink-0 mt-1.5" />
        )}
      </div>
    </div>
  );
}
