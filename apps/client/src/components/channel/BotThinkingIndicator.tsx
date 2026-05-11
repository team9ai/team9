import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import type { Variants } from "motion/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ChannelMember } from "@/types/im";
import type { BotThinkingStatus, BotThinkingPhase } from "./bot-thinking-state";

const PHASE_TEXT_KEYS: Record<BotThinkingPhase, readonly string[]> = {
  warming: [
    "botThinking.warmingTexts.warming",
    "botThinking.warmingTexts.headingOver",
    "botThinking.warmingTexts.commuting",
    "botThinking.warmingTexts.gatheringThoughts",
    "botThinking.warmingTexts.gettingReady",
    "botThinking.warmingTexts.findingSignal",
    "botThinking.warmingTexts.checkingMap",
    "botThinking.warmingTexts.openingNotebook",
    "botThinking.warmingTexts.syncingContext",
    "botThinking.warmingTexts.confirmingTask",
    "botThinking.warmingTexts.queueingUp",
    "botThinking.warmingTexts.settingUp",
  ],
  working: [
    "botThinking.workingTexts.workingHard",
    "botThinking.workingTexts.thinkingActively",
    "botThinking.workingTexts.processing",
    "botThinking.workingTexts.makingProgress",
    "botThinking.workingTexts.focusing",
    "botThinking.workingTexts.reviewingContext",
    "botThinking.workingTexts.breakingItDown",
    "botThinking.workingTexts.checkingDetails",
    "botThinking.workingTexts.connectingDots",
    "botThinking.workingTexts.draftingAnswer",
    "botThinking.workingTexts.verifyingResult",
    "botThinking.workingTexts.polishingResponse",
  ],
};

const LEGACY_TEXT_KEYS = [
  "botThinking.texts.thinking",
  "botThinking.texts.analyzing",
  "botThinking.texts.reasoning",
  "botThinking.texts.computing",
  "botThinking.texts.parsing",
  "botThinking.texts.brewing",
  "botThinking.texts.crafting",
  "botThinking.texts.decoding",
  "botThinking.texts.imagining",
  "botThinking.texts.composing",
] as const;

const CYCLE_INTERVAL_MS = 3000;

const dotVariants: Variants = {
  animate: ({ index, phase }: { index: number; phase: BotThinkingPhase }) => ({
    y: phase === "working" ? [2, -2, 2] : [1.5, -1.5, 1.5],
    opacity: phase === "working" ? [0.4, 1, 0.4] : [0.3, 0.65, 0.3],
    transition: {
      y: {
        repeat: Infinity,
        duration: phase === "working" ? 0.8 : 1.15,
        ease: "easeInOut" as const,
        delay: index * 0.15,
      },
      opacity: {
        repeat: Infinity,
        duration: phase === "working" ? 0.8 : 1.15,
        ease: "easeInOut" as const,
        delay: index * 0.15,
      },
    },
  }),
};

interface BotThinkingIndicatorProps {
  thinkingBotIds: string[];
  thinkingStatuses?: readonly BotThinkingStatus[];
  members: ChannelMember[];
}

export function BotThinkingIndicator({
  thinkingBotIds,
  thinkingStatuses = [],
  members,
}: BotThinkingIndicatorProps) {
  const { t } = useTranslation("channel");
  const [textIndex, setTextIndex] = useState(0);
  const primaryBotId = thinkingBotIds[0];
  const phase =
    thinkingStatuses.find((status) => status.botId === primaryBotId)?.phase ??
    "warming";
  const textKeys = PHASE_TEXT_KEYS[phase];
  const textKey = textKeys[textIndex];
  const translate = t as (key: string) => string;
  const translatedText = translate(textKey);
  const statusText =
    translatedText === textKey
      ? translate(LEGACY_TEXT_KEYS[textIndex % LEGACY_TEXT_KEYS.length])
      : translatedText;

  useEffect(() => {
    if (thinkingBotIds.length === 0) return;
    setTextIndex(0);

    const interval = setInterval(() => {
      setTextIndex((prev) => (prev + 1) % textKeys.length);
    }, CYCLE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [phase, textKeys.length, thinkingBotIds]);

  const isVisible = thinkingBotIds.length > 0;

  const botMember = members.find(
    (m) => thinkingBotIds.includes(m.userId) && m.user?.userType === "bot",
  );
  const botUser = botMember?.user;
  const botName = botUser?.displayName || botUser?.username || "Bot";
  const initials = botName[0] || "B";
  const isWorking = phase === "working";
  const glowClass = isWorking ? "bg-primary/20" : "bg-muted-foreground/15";
  const dotClass = isWorking ? "bg-primary" : "bg-muted-foreground/45";
  const statusClass = isWorking
    ? "text-muted-foreground"
    : "text-muted-foreground/75";

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="flex flex-row items-center gap-3 px-2 py-1"
          data-testid="bot-thinking-row"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          <div
            data-testid="bot-thinking-avatar-slot"
            className="flex h-9 w-9 shrink-0 items-center justify-center"
          >
            {/* Avatar with breathing glow */}
            <div className="relative h-7 w-7 shrink-0">
              <motion.div
                data-testid="bot-thinking-glow"
                className={`absolute -inset-px rounded-full ${glowClass}`}
                animate={{
                  opacity: isWorking ? [0.15, 0.4, 0.15] : [0.1, 0.25, 0.1],
                  scale: isWorking ? [1, 1.06, 1] : [1, 1.035, 1],
                }}
                transition={{
                  repeat: Infinity,
                  duration: isWorking ? 2 : 2.8,
                  ease: "easeInOut",
                }}
              />
              <Avatar className="relative w-7 h-7">
                {botUser?.avatarUrl ? (
                  <AvatarImage src={botUser.avatarUrl} alt={botName} />
                ) : (
                  <AvatarImage src="/bot.webp" alt={botName} />
                )}
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {initials.toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </div>
          </div>

          <div className="flex flex-row items-center gap-2 flex-1 min-w-0">
            <span className="font-semibold text-sm leading-5 shrink-0 max-w-40 truncate">
              {botName}
            </span>

            {/* Bouncing dots */}
            <div
              data-testid="bot-thinking-dots"
              className="flex h-5 translate-y-px items-center gap-1 shrink-0"
            >
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  data-testid="bot-thinking-dot"
                  className={`block w-[5px] h-[5px] rounded-full ${dotClass}`}
                  custom={{ index: i, phase }}
                  variants={dotVariants}
                  animate="animate"
                />
              ))}
            </div>

            {/* Status text with crossfade */}
            <div className="relative h-5 overflow-hidden min-w-0">
              <AnimatePresence mode="wait">
                <motion.span
                  data-testid="bot-thinking-status"
                  key={`${phase}-${textIndex}`}
                  className={`text-sm leading-5 ${statusClass} block truncate`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                >
                  {statusText}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
