import type { ComponentProps } from "react";

import { getInitials, getSeededAvatarGradient } from "@/lib/avatar-colors";
import chatgptLogo from "@/assets/base-model/chatgpt.svg";
import claudeLogo from "@/assets/base-model/claude.png";
import geminiLogo from "@/assets/base-model/gemini.webp";
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

  return (
    <Avatar {...props}>
      {avatarUrl ? (
        <AvatarImage src={avatarUrl} alt={displayName} />
      ) : baseModelProductKey ? (
        <AvatarImage
          src={BASE_MODEL_PRODUCT_LOGOS[baseModelProductKey]}
          alt={displayName}
          className="object-contain bg-white p-1.5"
        />
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
