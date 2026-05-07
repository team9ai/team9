import type { ComponentProps } from "react";

import { getInitials, getSeededAvatarGradient } from "@/lib/avatar-colors";
import chatgptLogo from "@/assets/base-model/chatgpt.svg";
import claudeLogo from "@/assets/base-model/claude.png";
import geminiLogo from "@/assets/base-model/gemini.svg";
import {
  getBaseModelProductKeyFromBotIdentity,
  type BaseModelProductKey,
} from "@/lib/base-model-agent";
import { cn } from "@/lib/utils";

import { Avatar, AvatarFallback, AvatarImage } from "./avatar";

export interface UserAvatarProps extends ComponentProps<typeof Avatar> {
  userId?: string;
  name?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  isBot?: boolean;
  showAiBadge?: boolean;
  fallbackClassName?: string;
}

const BASE_MODEL_PRODUCT_LOGOS: Record<BaseModelProductKey, string> = {
  claude: claudeLogo,
  chatgpt: chatgptLogo,
  gemini: geminiLogo,
};

export function UserAvatar({
  userId,
  name,
  username,
  avatarUrl,
  isBot,
  showAiBadge,
  fallbackClassName,
  ...props
}: UserAvatarProps) {
  const normalizedName = name?.trim() || null;
  const normalizedUsername = username?.trim() || null;
  const displayName = normalizedName || normalizedUsername || "Unknown User";
  const seed = userId?.trim() || normalizedUsername || normalizedName || "?";
  const initials = getInitials(normalizedName || normalizedUsername);
  const baseModelProductKey = getBaseModelProductKeyFromBotIdentity({
    isBot,
    name: normalizedName,
    username: normalizedUsername,
  });
  const { className, ...avatarProps } = props;

  return (
    <Avatar
      className={cn(className, showAiBadge && "overflow-visible")}
      {...avatarProps}
    >
      {avatarUrl ? (
        <AvatarImage
          src={avatarUrl}
          alt={displayName}
          className="rounded-full"
        />
      ) : baseModelProductKey ? (
        <AvatarImage
          src={BASE_MODEL_PRODUCT_LOGOS[baseModelProductKey]}
          alt={displayName}
          className="rounded-full object-contain bg-white p-1.5"
        />
      ) : isBot ? (
        <AvatarImage
          src="/bot.webp"
          alt={displayName}
          className="rounded-full"
        />
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
      {showAiBadge ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-[calc(100%-5px)] bottom-0 text-[7px] font-semibold leading-none text-nav-foreground-muted"
        >
          AI
        </span>
      ) : null}
    </Avatar>
  );
}
