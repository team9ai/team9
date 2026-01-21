import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Link } from "@tanstack/react-router";

export interface UserListItemProps {
  /** Display name */
  name: string;
  /** Avatar text (initials) */
  avatar: string;
  /** Avatar image URL */
  avatarUrl?: string;
  /** Whether user is online */
  isOnline?: boolean;
  /** Whether this item is selected */
  isSelected?: boolean;
  /** Unread message count */
  unreadCount?: number;
  /** Subtitle text (e.g., @username) */
  subtitle?: string;
  /** If provided, renders as a Link to this channel */
  channelId?: string;
  /** Click handler (used when channelId is not provided) */
  onClick?: () => void;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Avatar size: 'sm' (6) or 'default' (8) */
  avatarSize?: "sm" | "default";
}

/**
 * A reusable user list item component for sidebars.
 * Renders as a Link when channelId is provided, otherwise as a Button.
 */
export function UserListItem({
  name,
  avatar,
  avatarUrl,
  isOnline = false,
  isSelected = false,
  unreadCount = 0,
  subtitle,
  channelId,
  onClick,
  disabled = false,
  avatarSize = "default",
}: UserListItemProps) {
  const avatarSizeClass = avatarSize === "sm" ? "w-6 h-6" : "w-8 h-8";
  const avatarTextClass = avatarSize === "sm" ? "text-xs" : "text-sm";
  const onlineIndicatorSize = avatarSize === "sm" ? "w-2.5 h-2.5" : "w-3 h-3";

  const content = (
    <Button
      variant="ghost"
      onClick={channelId ? undefined : onClick}
      disabled={disabled}
      className={cn(
        "w-full justify-start gap-2 px-2 h-auto py-2 text-sm text-white/80 hover:bg-white/10 hover:text-white",
        isSelected && "bg-white/10 text-white",
        disabled && "opacity-50",
      )}
    >
      <div className="relative">
        <Avatar className={avatarSizeClass}>
          {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
          <AvatarFallback
            className={cn("bg-purple-400 text-white", avatarTextClass)}
          >
            {avatar}
          </AvatarFallback>
        </Avatar>
        {isOnline && (
          <div
            className={cn(
              "absolute -bottom-0.5 -right-0.5 bg-green-500 rounded-full border-2 border-[#5b2c6f]",
              onlineIndicatorSize,
            )}
          />
        )}
      </div>
      <div className="flex-1 text-left truncate">
        <div className="truncate">{name}</div>
        {subtitle && (
          <div className="text-xs text-white/50 truncate">{subtitle}</div>
        )}
      </div>
      {unreadCount > 0 && (
        <Badge variant="notification" size="sm" count={unreadCount} />
      )}
    </Button>
  );

  if (channelId) {
    return (
      <Link to="/channels/$channelId" params={{ channelId }}>
        {content}
      </Link>
    );
  }

  return content;
}
