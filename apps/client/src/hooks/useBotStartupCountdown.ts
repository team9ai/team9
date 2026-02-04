import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { Channel, ChannelWithUnread, ChannelMember } from "@/types/im";

// Total bot startup time in seconds
const BOT_STARTUP_DURATION = 150;

export type BotStartupPhase = "countdown" | "ready" | "chatting" | null;

interface UseBotStartupCountdownOptions {
  channel: Channel | ChannelWithUnread | undefined;
  members: ChannelMember[];
}

interface UseBotStartupCountdownResult {
  phase: BotStartupPhase;
  remainingSeconds: number;
  startChatting: () => void;
  showOverlay: boolean;
}

export function useBotStartupCountdown({
  channel,
  members,
}: UseBotStartupCountdownOptions): UseBotStartupCountdownResult {
  const otherUser = (channel as ChannelWithUnread | undefined)?.otherUser;

  const isBotDm = useMemo(() => {
    return channel?.type === "direct" && otherUser?.userType === "bot";
  }, [channel?.type, otherUser?.userType]);

  // Get bot's createdAt from channel members
  const botCreatedAt = useMemo(() => {
    if (!isBotDm) return null;
    const botMember = members.find((m) => m.user?.userType === "bot");
    return botMember?.user?.createdAt ?? null;
  }, [isBotDm, members]);

  const getInitialRemaining = useCallback((): number => {
    if (!botCreatedAt) return 0;
    const createdTime = new Date(botCreatedAt).getTime();
    const elapsed = Math.floor((Date.now() - createdTime) / 1000);
    return Math.max(0, BOT_STARTUP_DURATION - elapsed);
  }, [botCreatedAt]);

  const [phase, setPhase] = useState<BotStartupPhase>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Initialize phase when bot data becomes available
  useEffect(() => {
    if (!isBotDm) {
      setPhase(null);
      setRemainingSeconds(0);
      return;
    }

    if (!botCreatedAt) {
      // Members haven't loaded yet
      return;
    }

    const remaining = getInitialRemaining();
    if (remaining <= 0) {
      setPhase("chatting");
      setRemainingSeconds(0);
    } else {
      setPhase("countdown");
      setRemainingSeconds(remaining);
    }
  }, [isBotDm, botCreatedAt, getInitialRemaining]);

  // Run the countdown timer
  useEffect(() => {
    if (phase !== "countdown") {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          intervalRef.current = null;
          setPhase("ready");
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [phase]);

  const startChatting = useCallback(() => {
    if (phase === "ready") {
      setPhase("chatting");
    }
  }, [phase]);

  return {
    phase,
    remainingSeconds,
    startChatting,
    showOverlay: phase === "countdown" || phase === "ready",
  };
}
