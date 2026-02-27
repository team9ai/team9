import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface Replier {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  userType: string;
}

interface ThreadReplyIndicatorProps {
  replyCount: number;
  lastRepliers?: Replier[];
  lastReplyAt?: string;
  unreadCount?: number;
  onClick?: () => void;
}

export function ThreadReplyIndicator({
  replyCount,
  lastRepliers = [],
  lastReplyAt,
  unreadCount,
  onClick,
}: ThreadReplyIndicatorProps) {
  const { t } = useTranslation("thread");

  if (replyCount === 0) return null;

  const hasUnread = unreadCount != null && unreadCount > 0;

  return (
    <div className="flex items-center gap-1 mt-1">
      <button
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors",
          hasUnread
            ? "bg-info/10 border border-info/40 text-info hover:bg-info/20"
            : "hover:bg-muted",
        )}
      >
        {/* Avatar stack */}
        {lastRepliers.length > 0 && (
          <div className="flex items-center -space-x-1.5">
            {lastRepliers.slice(0, 5).map((replier) => {
              const initial =
                replier.displayName?.[0] || replier.username[0] || "?";
              return (
                <Avatar
                  key={replier.id}
                  className="w-5 h-5 ring-2 ring-background"
                >
                  {replier.avatarUrl && (
                    <AvatarImage
                      src={replier.avatarUrl}
                      alt={replier.displayName || replier.username}
                    />
                  )}
                  {replier.userType === "bot" && !replier.avatarUrl && (
                    <AvatarImage
                      src="/bot.webp"
                      alt={replier.displayName || replier.username}
                    />
                  )}
                  <AvatarFallback className="bg-primary text-primary-foreground text-[8px]">
                    {initial.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              );
            })}
          </div>
        )}

        {/* Reply count text */}
        <span
          className={cn("font-medium", hasUnread ? "text-info" : "text-info")}
        >
          {t("repliesCount", { count: replyCount })}
        </span>

        {/* Unread badge */}
        {hasUnread && (
          <span className="px-1 py-px bg-info text-primary-foreground text-[10px] font-medium rounded-full min-w-3.5 text-center leading-tight">
            {unreadCount! > 99 ? "99+" : unreadCount}
          </span>
        )}

        {/* Last reply time */}
        {lastReplyAt && (
          <span className="text-muted-foreground">
            {formatDistanceToNow(new Date(lastReplyAt))}
          </span>
        )}
      </button>
    </div>
  );
}

function formatDistanceToNow(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m`;
  if (diffHour < 24) return `${diffHour}h`;
  if (diffDay < 30) return `${diffDay}d`;
  return date.toLocaleDateString();
}
