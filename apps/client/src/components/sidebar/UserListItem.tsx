import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";
import { useIsUserOnline } from "@/hooks/useIMUsers";

export interface UserListItemProps {
  /** Display name */
  name: string;
  /** Avatar text (initials) */
  avatar: string;
  /** Avatar image URL */
  avatarUrl?: string;
  /** User ID for real-time online status detection */
  userId?: string;
  /** Whether this item is selected */
  isSelected?: boolean;
  /** Unread message count */
  unreadCount?: number;
  /** Subtitle text (e.g., @username) */
  subtitle?: string;
  /** If provided, renders as a Link to this channel */
  channelId?: string;
  /** Link path prefix (default: "/channels"). Use "/messages" for direct messages */
  linkPrefix?: "/channels" | "/messages";
  /** Click handler (used when channelId is not provided) */
  onClick?: () => void;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Avatar size: 'sm' (6) or 'default' (8) */
  avatarSize?: "sm" | "default";
  /** Whether this user is a bot */
  isBot?: boolean;
}

/**
 * A reusable user list item component for sidebars.
 * Renders as a Link when channelId is provided, otherwise as a Button.
 */
export function UserListItem({
  name,
  avatar,
  avatarUrl,
  userId,
  isSelected = false,
  unreadCount = 0,
  subtitle,
  channelId,
  linkPrefix = "/channels",
  onClick,
  disabled = false,
  avatarSize = "default",
  isBot = false,
}: UserListItemProps) {
  const isOnline = useIsUserOnline(userId);
  const avatarSizeClass = avatarSize === "sm" ? "w-6 h-6" : "w-8 h-8";
  const avatarTextClass = avatarSize === "sm" ? "text-xs" : "text-sm";
  const onlineIndicatorSize = avatarSize === "sm" ? "w-2.5 h-2.5" : "w-3 h-3";

  const content = (
    <Button
      variant="ghost"
      onClick={channelId ? undefined : onClick}
      disabled={disabled}
      className={cn(
        "w-full justify-start gap-2 px-2 h-auto py-2 text-sm text-nav-foreground-muted hover:bg-nav-hover hover:text-nav-foreground",
        isSelected && "bg-nav-active text-nav-foreground",
        disabled && "opacity-50",
      )}
    >
      <div className="relative">
        <Avatar className={avatarSizeClass}>
          {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
          {isBot && !avatarUrl && <AvatarImage src="/bot.webp" alt={name} />}
          <AvatarFallback
            className={cn("bg-accent text-accent-foreground", avatarTextClass)}
          >
            {avatar}
          </AvatarFallback>
        </Avatar>
        {isOnline && (
          <div
            className={cn(
              "absolute -bottom-0.5 -right-0.5 bg-success rounded-full border-2 border-nav-sub-bg",
              onlineIndicatorSize,
            )}
          />
        )}
      </div>
      <div className="flex-1 text-left truncate">
        <div className="truncate">{name}</div>
        {subtitle && (
          <div className="text-xs text-nav-foreground-faint truncate">
            {subtitle}
          </div>
        )}
      </div>
      {unreadCount > 0 && (
        <Badge variant="notification" size="sm" count={unreadCount} />
      )}
    </Button>
  );

  if (channelId) {
    const linkTo =
      linkPrefix === "/messages"
        ? "/messages/$channelId"
        : "/channels/$channelId";
    return (
      <Link to={linkTo} params={{ channelId }}>
        {content}
      </Link>
    );
  }

  return content;
}
