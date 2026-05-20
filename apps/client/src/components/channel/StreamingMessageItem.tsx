import { memo } from "react";
import { motion } from "motion/react";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatElapsed(startedAt: number): string {
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes <= 0) return "刚刚开始";
  return `已运行 ${minutes} 分钟`;
}

function getDeepResearchStatus(stream: StreamingMessage): string | null {
  const deepResearch = isRecord(stream.metadata?.deepResearch)
    ? stream.metadata.deepResearch
    : null;
  if (!deepResearch) return null;

  const kind = deepResearch.kind === "plan" ? "plan" : "report";
  const status =
    typeof deepResearch.status === "string" ? deepResearch.status : "running";
  if (status === "failed") {
    const error =
      typeof deepResearch.error === "string" ? `：${deepResearch.error}` : "";
    return kind === "plan"
      ? `研究方案生成失败${error}`
      : `深度研究失败${error}`;
  }

  const phase =
    typeof deepResearch.phase === "string" ? deepResearch.phase : "running";
  const phaseText =
    kind === "plan"
      ? phase === "submitted"
        ? "正在准备研究方案"
        : phase === "started"
          ? "正在拟定研究方案"
          : phase === "finalizing_plan" || phase === "plan_ready"
            ? "正在整理研究方案"
            : "正在梳理研究方向和资料范围"
      : phase === "submitted"
        ? "正在启动深度研究"
        : phase === "started"
          ? "正在规划研究并检索资料"
          : phase === "synthesizing"
            ? "正在整理研究报告"
            : "正在检索和分析资料";
  const completionTarget = kind === "plan" ? "方案" : "报告";

  return `${phaseText}，${formatElapsed(stream.startedAt)}。${completionTarget}完成后会直接显示在这里。`;
}

function getDeepResearchStatusLabel(stream: StreamingMessage): string {
  const deepResearch = isRecord(stream.metadata?.deepResearch)
    ? stream.metadata.deepResearch
    : null;
  if (!deepResearch) return "streaming...";
  const kind = deepResearch.kind === "plan" ? "plan" : "report";
  if (kind === "plan") {
    return stream.isStreaming ? "拟定方案中" : "研究方案";
  }
  return stream.isStreaming ? "深度研究中" : "深度研究";
}

export const StreamingMessageItem = memo(function StreamingMessageItem({
  stream,
  members,
}: StreamingMessageItemProps) {
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
  const deepResearchStatus = getDeepResearchStatus(stream);
  const statusLabel = getDeepResearchStatusLabel(stream);
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
