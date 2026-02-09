import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ChannelMember } from "@/types/im";

const THINKING_TEXTS_KEYS = [
  "botThinking",
  "botAnalyzing",
  "botGenerating",
] as const;

const CYCLE_INTERVAL_MS = 2500;

interface BotThinkingIndicatorProps {
  thinkingBotIds: string[];
  members: ChannelMember[];
}

export function BotThinkingIndicator({
  thinkingBotIds,
  members,
}: BotThinkingIndicatorProps) {
  const { t } = useTranslation("message");
  const [textIndex, setTextIndex] = useState(0);

  useEffect(() => {
    if (thinkingBotIds.length === 0) return;
    setTextIndex(0);
    const interval = setInterval(() => {
      setTextIndex((prev) => (prev + 1) % THINKING_TEXTS_KEYS.length);
    }, CYCLE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [thinkingBotIds]);

  if (thinkingBotIds.length === 0) return null;

  // Find the first thinking bot's info from members
  const botMember = members.find(
    (m) => thinkingBotIds.includes(m.userId) && m.user?.userType === "bot",
  );
  const botUser = botMember?.user;
  const botName = botUser?.displayName || botUser?.username || "Bot";
  const initials = botName[0] || "B";

  return (
    <div className="flex gap-3 px-2 py-1 animate-in fade-in duration-300">
      <Avatar className="w-9 h-9 shrink-0">
        {botUser?.avatarUrl ? (
          <AvatarImage src={botUser.avatarUrl} alt={botName} />
        ) : (
          <AvatarImage src="/bot.webp" alt={botName} />
        )}
        <AvatarFallback className="bg-primary text-primary-foreground text-sm">
          {initials.toUpperCase()}
        </AvatarFallback>
      </Avatar>

      <div className="flex flex-col items-start flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="font-semibold text-sm">{botName}</span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-block text-primary animate-pulse text-base font-bold">
            *
          </span>
          <span className="animate-pulse">
            {t(THINKING_TEXTS_KEYS[textIndex])}...
          </span>
        </div>
      </div>
    </div>
  );
}
