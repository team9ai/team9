import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import type { Variants } from "motion/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ChannelMember } from "@/types/im";

const THINKING_TEXTS = [
  "Thinking",
  "Analyzing",
  "Reasoning",
  "Computing",
  "Parsing",
  "Brewing",
  "Crafting",
  "Decoding",
  "Imagining",
  "Composing",
] as const;

const CYCLE_INTERVAL_MS = 3000;

const dotVariants: Variants = {
  animate: (i: number) => ({
    y: [0, -5, 0],
    opacity: [0.4, 1, 0.4],
    transition: {
      y: {
        repeat: Infinity,
        duration: 0.8,
        ease: "easeInOut" as const,
        delay: i * 0.15,
      },
      opacity: {
        repeat: Infinity,
        duration: 0.8,
        ease: "easeInOut" as const,
        delay: i * 0.15,
      },
    },
  }),
};

interface BotThinkingIndicatorProps {
  thinkingBotIds: string[];
  members: ChannelMember[];
}

export function BotThinkingIndicator({
  thinkingBotIds,
  members,
}: BotThinkingIndicatorProps) {
  const [textIndex, setTextIndex] = useState(0);

  useEffect(() => {
    if (thinkingBotIds.length === 0) return;
    setTextIndex(0);

    const interval = setInterval(() => {
      setTextIndex((prev) => (prev + 1) % THINKING_TEXTS.length);
    }, CYCLE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [thinkingBotIds]);

  const isVisible = thinkingBotIds.length > 0;

  const botMember = members.find(
    (m) => thinkingBotIds.includes(m.userId) && m.user?.userType === "bot",
  );
  const botUser = botMember?.user;
  const botName = botUser?.displayName || botUser?.username || "Bot";
  const initials = botName[0] || "B";

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="flex gap-3 px-2 py-2"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          {/* Avatar with breathing glow */}
          <div className="relative shrink-0">
            <motion.div
              className="absolute -inset-0.5 rounded-full bg-primary/25"
              animate={{ opacity: [0.2, 0.5, 0.2], scale: [1, 1.08, 1] }}
              transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
            />
            <Avatar className="relative w-9 h-9">
              {botUser?.avatarUrl ? (
                <AvatarImage src={botUser.avatarUrl} alt={botName} />
              ) : (
                <AvatarImage src="/bot.webp" alt={botName} />
              )}
              <AvatarFallback className="bg-primary text-primary-foreground text-sm">
                {initials.toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </div>

          <div className="flex flex-col items-start flex-1 min-w-0">
            <span className="font-semibold text-sm mb-0.5">{botName}</span>

            <div className="flex items-center gap-2">
              {/* Bouncing dots */}
              <div className="flex items-center gap-1">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    className="block w-[5px] h-[5px] rounded-full bg-primary"
                    custom={i}
                    variants={dotVariants}
                    animate="animate"
                  />
                ))}
              </div>

              {/* Status text with crossfade */}
              <div className="relative h-5 overflow-hidden">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={textIndex}
                    className="text-sm text-muted-foreground block"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                  >
                    {THINKING_TEXTS[textIndex]}
                  </motion.span>
                </AnimatePresence>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
