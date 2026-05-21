import { memo } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MessageContent } from "./MessageContent";
import {
  DeepResearchProgressCard,
  getDeepResearchProgressMeta,
} from "./DeepResearchProgressCard";
import type { StreamingMessage } from "@/stores/useStreamingStore";
import type { ChannelMember } from "@/types/im";

interface StreamingMessageItemProps {
  stream: StreamingMessage;
  members: ChannelMember[];
}

type ChannelTFunction = TFunction<"channel">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatElapsed(startedAt: number, t: ChannelTFunction): string {
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes <= 0) return t("deepResearch.stream.elapsedJustStarted");
  return t("deepResearch.stream.elapsedMinutes", { count: minutes });
}

function getDeepResearchStatus(
  stream: StreamingMessage,
  t: ChannelTFunction,
): string | null {
  const deepResearch = isRecord(stream.metadata?.deepResearch)
    ? stream.metadata.deepResearch
    : null;
  if (!deepResearch) return null;

  const kind = deepResearch.kind === "plan" ? "plan" : "report";
  const status =
    typeof deepResearch.status === "string" ? deepResearch.status : "running";
  if (status === "failed") {
    const error =
      typeof deepResearch.error === "string"
        ? t("deepResearch.stream.errorSuffix", {
            error: deepResearch.error,
          })
        : "";
    return kind === "plan"
      ? t("deepResearch.stream.failedPlan", { error })
      : t("deepResearch.stream.failedReport", { error });
  }

  const phase =
    typeof deepResearch.phase === "string" ? deepResearch.phase : "running";
  const phaseText =
    kind === "plan"
      ? phase === "submitted"
        ? t("deepResearch.stream.phase.planSubmitted")
        : phase === "started"
          ? t("deepResearch.stream.phase.planStarted")
          : phase === "finalizing_plan" || phase === "plan_ready"
            ? t("deepResearch.stream.phase.planFinalizing")
            : t("deepResearch.stream.phase.planDefault")
      : phase === "submitted"
        ? t("deepResearch.stream.phase.reportSubmitted")
        : phase === "started"
          ? t("deepResearch.stream.phase.reportStarted")
          : phase === "synthesizing"
            ? t("deepResearch.stream.phase.reportSynthesizing")
            : t("deepResearch.stream.phase.reportDefault");
  const completionTarget =
    kind === "plan"
      ? t("deepResearch.stream.targetPlan")
      : t("deepResearch.stream.targetReport");

  return t("deepResearch.stream.statusLine", {
    phase: phaseText,
    elapsed: formatElapsed(stream.startedAt, t),
    target: completionTarget,
  });
}

function getDeepResearchStatusLabel(
  stream: StreamingMessage,
  t: ChannelTFunction,
): string {
  const deepResearch = isRecord(stream.metadata?.deepResearch)
    ? stream.metadata.deepResearch
    : null;
  if (!deepResearch) return t("deepResearch.stream.defaultStatus");
  const kind = deepResearch.kind === "plan" ? "plan" : "report";
  if (kind === "plan") {
    return stream.isStreaming
      ? t("deepResearch.stream.planStreamingLabel")
      : t("deepResearch.stream.planDoneLabel");
  }
  return stream.isStreaming
    ? t("deepResearch.stream.reportStreamingLabel")
    : t("deepResearch.stream.reportDoneLabel");
}

export const StreamingMessageItem = memo(function StreamingMessageItem({
  stream,
  members,
}: StreamingMessageItemProps) {
  const { t } = useTranslation("channel");
  const botMember = members.find((m) => m.userId === stream.senderId);
  const botUser = botMember?.user;
  const botName = botUser?.displayName || botUser?.username || "Bot";
  const initials = botName[0] || "B";
  const streamingCursor =
    stream.isStreaming && !stream.isThinking ? (
      <span
        data-testid="streaming-text-cursor"
        className="inline-block w-1.5 h-4 bg-foreground/70 animate-pulse ml-0.5 align-text-bottom"
      />
    ) : null;
  const deepResearchStatus = getDeepResearchStatus(stream, t);
  const statusLabel = getDeepResearchStatusLabel(stream, t);
  const deepResearchProgress = getDeepResearchProgressMeta(stream.metadata);

  return (
    <motion.div
      className="flex gap-3 px-2 py-1"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      <Avatar className="shrink-0 w-9 h-9">
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
          <span className="text-xs text-muted-foreground">{statusLabel}</span>
        </div>

        {/* Thinking is now surfaced by a sibling StreamingThinkingRow
            rendered by MessageList above this bubble — keeps the
            in-flight UI identical to the persisted tracking row. */}

        {deepResearchProgress && (
          <DeepResearchProgressCard
            meta={deepResearchProgress}
            isStreaming={stream.isStreaming}
            startedAt={stream.startedAt}
            className={stream.content ? "mb-3" : undefined}
          />
        )}

        {/* Streaming text content */}
        {stream.content ? (
          <div className="channel-message-content w-full min-w-0">
            <MessageContent
              content={stream.content}
              className="text-sm whitespace-pre-wrap break-words"
              trailingInline={streamingCursor}
            />
          </div>
        ) : deepResearchStatus && !deepResearchProgress ? (
          <div className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
            {deepResearchStatus}
          </div>
        ) : stream.isThinking ? null : (
          /* Show dots only when no content and not thinking yet */
          <div className="flex gap-1 py-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="block w-[5px] h-[5px] rounded-full bg-primary animate-bounce"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
});
