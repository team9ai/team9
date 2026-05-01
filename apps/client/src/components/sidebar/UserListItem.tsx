import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { AgentTypeBadge } from "@/components/ui/agent-type-badge";
import { UserAvatar } from "@/components/ui/user-avatar";
import { Link } from "@tanstack/react-router";
import { useIsUserOnline } from "@/hooks/useIMUsers";
import type { AgentType } from "@/types/im";
import { AgentPillRow } from "./AgentPillRow";

export interface UserListItemProps {
  /** Display name */
  name: string;
  /** Avatar text (initials) */
  avatar?: string;
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
  /** Managed agent category for badge display */
  agentType?: AgentType | null;
  /** Bot staff classification — drives second-line pill rendering */
  staffKind?: "common" | "personal" | "other" | null;
  /** Common-staff role title (only used when staffKind='common') */
  roleTitle?: string | null;
  /** Personal-staff owner display name (only used when staffKind='personal') */
  ownerName?: string | null;
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
  agentType,
  staffKind,
  roleTitle,
  ownerName,
}: UserListItemProps) {
  const isOnline = useIsUserOnline(userId);
  const avatarSizeClass = avatarSize === "sm" ? "w-6 h-6" : "w-9 h-9";
  const avatarTextClass = avatarSize === "sm" ? "text-xs" : "text-sm";
  const onlineIndicatorSize = avatarSize === "sm" ? "w-2.5 h-2.5" : "w-3 h-3";
  const username = subtitle?.startsWith("@") ? subtitle.slice(1) : undefined;

  const rootClassName = cn(
    "flex w-full min-w-0 max-w-full shrink items-center gap-2 overflow-hidden rounded-md px-2 py-2 text-left text-sm font-medium text-nav-foreground-muted transition-all hover:bg-nav-hover hover:text-nav-foreground",
    isSelected && "bg-nav-active text-nav-foreground",
    disabled && "pointer-events-none cursor-not-allowed opacity-50",
  );

  const content = (
    <>
      <div className="relative shrink-0">
        <UserAvatar
          userId={userId}
          name={name || avatar}
          username={username}
          avatarUrl={avatarUrl}
          isBot={isBot}
          className={avatarSizeClass}
          fallbackClassName={avatarTextClass}
        />
        {isOnline && (
          <div
            className={cn(
              "absolute -bottom-0.5 -right-0.5 bg-success rounded-full border-2 border-nav-sub-bg",
              onlineIndicatorSize,
            )}
          />
        )}
      </div>
      <div className="min-w-0 flex-1 basis-0 overflow-hidden text-left">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex-1 min-w-0 truncate" title={name}>
            {name}
          </div>
          <AgentTypeBadge agentType={agentType} />
        </div>
        {isBot && staffKind ? (
          <AgentPillRow
            staffKind={staffKind}
            roleTitle={roleTitle}
            ownerName={ownerName}
          />
        ) : subtitle ? (
          <div
            className="block w-full min-w-0 max-w-[22ch] truncate text-xs text-nav-foreground-faint"
            title={subtitle}
          >
            {subtitle}
          </div>
        ) : null}
      </div>
      {unreadCount > 0 && (
        <Badge variant="notification" size="sm" count={unreadCount} />
      )}
    </>
  );

  if (channelId) {
    const linkTo =
      linkPrefix === "/messages"
        ? "/messages/$channelId"
        : "/channels/$channelId";
    return (
      <Link to={linkTo} params={{ channelId }} className={rootClassName}>
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={rootClassName}
    >
      {content}
    </button>
  );
}
