import { createPortal } from "react-dom";
import { useRef, useMemo } from "react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { useIMUser, useIsUserOnline } from "@/hooks/useIMUsers";

interface UserProfileCardProps {
  userId: string;
  displayName: string;
  anchorRect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function UserProfileCard({
  userId,
  displayName,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
}: UserProfileCardProps) {
  const { data: user, isLoading } = useIMUser(userId);
  const isOnline = useIsUserOnline(userId);
  const cardRef = useRef<HTMLDivElement>(null);

  // Calculate position synchronously to avoid double-render flash
  const position = useMemo(() => {
    const CARD_WIDTH = 280;
    const CARD_HEIGHT_ESTIMATE = 180;
    const OFFSET = 8;

    // Prefer below the anchor; when no room, anchor the card's bottom edge
    // to just above the anchor so actual card height doesn't leave a gap.
    const placeBelow =
      anchorRect.bottom + OFFSET + CARD_HEIGHT_ESTIMATE <= window.innerHeight;

    // Center horizontally on the anchor, clamped to viewport
    let left = anchorRect.left + anchorRect.width / 2 - CARD_WIDTH / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - CARD_WIDTH - 8));

    if (placeBelow) {
      return { top: Math.max(8, anchorRect.bottom + OFFSET), left };
    }
    return {
      bottom: Math.max(8, window.innerHeight - anchorRect.top + OFFSET),
      left,
    };
  }, [anchorRect]);

  const name = user?.displayName || user?.username || displayName;

  return createPortal(
    <div
      ref={cardRef}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed z-50 w-[280px] rounded-lg border bg-popover text-popover-foreground shadow-lg animate-in fade-in-0 zoom-in-95 duration-150"
      style={position}
    >
      {isLoading ? (
        <div className="p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-muted animate-pulse shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-muted rounded animate-pulse w-24" />
            <div className="h-3 bg-muted rounded animate-pulse w-16" />
          </div>
        </div>
      ) : (
        <div className="p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="relative shrink-0">
              <UserAvatar
                userId={user?.id ?? userId}
                name={user?.displayName ?? name}
                username={user?.username}
                avatarUrl={user?.avatarUrl}
                isBot={user?.userType === "bot"}
                className="w-12 h-12"
                fallbackClassName="text-lg"
              />
              <span
                className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-popover ${
                  isOnline ? "bg-success" : "bg-muted-foreground/40"
                }`}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{name}</p>
              {user?.username && (
                <p className="text-xs text-muted-foreground truncate">
                  @{user.username}
                </p>
              )}
              {user?.email && (
                <p className="text-xs text-muted-foreground truncate">
                  {user.email}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
