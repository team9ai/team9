import type { ComponentProps } from "react";

import { getInitials, getSeededAvatarGradient } from "@/lib/avatar-colors";
import { cn } from "@/lib/utils";

import { Avatar, AvatarFallback, AvatarImage } from "./avatar";

export interface UserAvatarProps extends ComponentProps<typeof Avatar> {
  userId?: string;
  name?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  isBot?: boolean;
  fallbackClassName?: string;
}

export function UserAvatar({
  userId,
  name,
  username,
  avatarUrl,
  isBot,
  fallbackClassName,
  ...props
}: UserAvatarProps) {
  const normalizedName = name?.trim() || null;
  const normalizedUsername = username?.trim() || null;
  const displayName = normalizedName || normalizedUsername || "Unknown User";
  const seed = userId?.trim() || normalizedUsername || normalizedName || "?";
  const initials = getInitials(normalizedName || normalizedUsername);

  return (
    <Avatar {...props}>
      {avatarUrl ? (
        <AvatarImage src={avatarUrl} alt={displayName} />
      ) : isBot ? (
        <AvatarImage src="/bot.webp" alt={displayName} />
      ) : null}
      <AvatarFallback
        className={cn(
          "bg-linear-to-br text-white",
          getSeededAvatarGradient(seed),
          fallbackClassName,
        )}
      >
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}
