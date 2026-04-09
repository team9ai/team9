import { useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getLabel, type StatusType } from "@/config/toolLabels";
import type { AgentEventMetadata } from "@/types/im";

interface TrackingEventItemProps {
  metadata: AgentEventMetadata;
  content: string;
  /** Whether this item is actively streaming */
  isStreaming?: boolean;
  /** Whether to show in compact mode (inline card) vs full mode (modal) */
  compact?: boolean;
  /** Whether content is collapsible (for thinking/tool_result) */
  collapsible?: boolean;
}

const STATUS_DOT_CLASSES: Record<AgentEventMetadata["status"], string> = {
  running: "bg-emerald-500 animate-pulse",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  resolved: "bg-emerald-500",
  timeout: "bg-amber-500",
  cancelled: "bg-red-500",
};

const LABEL_CLASSES: Record<AgentEventMetadata["status"], string> = {
  running: "text-yellow-400",
  completed: "text-emerald-500",
  failed: "text-red-500",
  resolved: "text-emerald-500",
  timeout: "text-amber-500",
  cancelled: "text-red-500",
};

const EVENT_LABELS: Record<AgentEventMetadata["agentEventType"], string> = {
  thinking: "Thinking",
  writing: "Writing",
  tool_call: "Calling",
  tool_result: "Result",
  agent_start: "Started",
  agent_end: "Completed",
  error: "Error",
  turn_separator: "Turn",
  a2ui_surface_update: "Choices",
  a2ui_response: "Selected",
};

function truncateLine(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen);
}

/**
 * Format a duration in milliseconds into a human-readable Chinese string.
 * - < 60 seconds: "45秒"
 * - >= 60 seconds: "2分3秒"
 * Millisecond values are floored to whole seconds.
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}分${seconds}秒`;
}

/**
 * Build the stats label for a thinking event, e.g.
 *   "Thinking (1200 tokens, 2分3秒)"
 *   "Thinking (1200 tokens)"
 *   "Thinking (2分3秒)"
 *   "Thinking"
 *
 * When `isStreaming` and `metadata.startedAt` is present, the duration is
 * computed live from the current clock. The caller is expected to re-render
 * on a timer to refresh this value.
 */
export function buildThinkingStats(
  metadata: AgentEventMetadata,
  isStreaming: boolean,
  nowMs: number = Date.now(),
): string {
  const parts: string[] = [];

  // Tokens: prefer totalTokens, fall back to outputTokens.
  const tokens =
    typeof metadata.totalTokens === "number"
      ? metadata.totalTokens
      : metadata.outputTokens;
  if (typeof tokens === "number" && tokens > 0) {
    parts.push(`${tokens} tokens`);
  }

  // Duration: while streaming, compute from startedAt; otherwise use
  // the final durationMs captured on completion.
  if (isStreaming && metadata.startedAt) {
    const startTs = new Date(metadata.startedAt).getTime();
    if (!Number.isNaN(startTs)) {
      const elapsed = nowMs - startTs;
      if (elapsed > 0) {
        parts.push(formatDuration(elapsed));
      }
    }
  } else if (
    typeof metadata.durationMs === "number" &&
    metadata.durationMs > 0
  ) {
    parts.push(formatDuration(metadata.durationMs));
  }

  if (parts.length === 0) return "Thinking";
  return `Thinking (${parts.join(", ")})`;
}

/**
 * Map an AgentEventMetadata status to the StatusType expected by getLabel().
 * running -> loading, completed/resolved -> success, everything else -> error.
 */
function toLabelStatus(status: AgentEventMetadata["status"]): StatusType {
  if (status === "running") return "loading";
  if (status === "completed" || status === "resolved") return "success";
  return "error";
}

export function TrackingEventItem({
  metadata,
  content,
  isStreaming = false,
  compact: _compact = true,
  collapsible = false,
}: TrackingEventItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Live-updating tick for streaming thinking events so the elapsed
  // duration in the label refreshes once per second. Only schedules
  // an interval when we actually need live updates.
  const [, setNowTick] = useState(0);
  const isThinking = metadata.agentEventType === "thinking";
  const shouldLiveUpdate = isThinking && isStreaming && !!metadata.startedAt;
  useEffect(() => {
    if (!shouldLiveUpdate) return;
    const interval = setInterval(() => {
      setNowTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [shouldLiveUpdate]);

  // Turn separators are internal markers and should not be shown to users.
  if (metadata.agentEventType === "turn_separator") {
    return null;
  }

  const status = isStreaming ? "running" : metadata.status;

  // For tool_call events, use the localized label system from toolLabels.
  // This replaces the hardcoded "Calling" label with tool-specific copy
  // (e.g. "正在发送消息" / "消息发送完成" / "消息发送失败").
  const toolCallLabel =
    metadata.agentEventType === "tool_call"
      ? getLabel("invoke_tool", metadata.toolName, toLabelStatus(status))
      : null;

  const label = isThinking
    ? buildThinkingStats(metadata, isStreaming)
    : (toolCallLabel ??
      EVENT_LABELS[metadata.agentEventType] ??
      metadata.agentEventType);

  const labelColorClass =
    isThinking && status !== "failed"
      ? "text-purple-400"
      : LABEL_CLASSES[status];

  // Thinking events are special: no status dot, and default to
  // collapsible even when `collapsible` prop isn't explicitly set.
  const effectiveCollapsible = collapsible || isThinking;

  // For thinking, prefer metadata.thinking over the plain content prop.
  const thinkingBody =
    isThinking && typeof metadata.thinking === "string" && metadata.thinking
      ? metadata.thinking
      : content;

  const displayContent =
    metadata.agentEventType === "tool_call" && metadata.toolName
      ? metadata.toolName
      : isThinking
        ? thinkingBody
        : content;

  const summaryContent = effectiveCollapsible
    ? displayContent.length > 60
      ? truncateLine(displayContent, 60) + " ..."
      : displayContent
    : displayContent;

  return (
    <div>
      {/* Main row */}
      <div
        className={cn(
          "flex items-center min-h-6",
          effectiveCollapsible && "cursor-pointer group",
        )}
        onClick={
          effectiveCollapsible ? () => setIsExpanded(!isExpanded) : undefined
        }
      >
        {/* Status dot — hidden for thinking events by design */}
        {!isThinking && (
          <div
            className={cn(
              "w-2 h-2 rounded-full shrink-0 mr-[26px]",
              STATUS_DOT_CLASSES[status],
            )}
          />
        )}
        {/* Label */}
        <span
          className={cn(
            "text-xs font-semibold shrink-0",
            isThinking ? "whitespace-nowrap" : "w-[72px]",
            labelColorClass,
            isThinking && isStreaming && "animate-pulse",
          )}
        >
          {label}
        </span>
        {/* Content — thinking keeps the label-only row; body lives in the
            expandable panel below. */}
        {!isThinking && (
          <span
            className={cn(
              "text-xs truncate flex-1 min-w-0 ml-2",
              metadata.agentEventType === "tool_call" ||
                metadata.agentEventType === "tool_result"
                ? "font-mono text-foreground/80"
                : "text-muted-foreground",
            )}
          >
            {summaryContent}
            {isStreaming && (
              <span className="inline-block w-0.5 h-3.5 bg-yellow-400 animate-pulse ml-0.5 align-text-bottom" />
            )}
          </span>
        )}
        {/* Spacer pushes the chevron to the right for thinking rows. */}
        {isThinking && <div className="flex-1" />}
        {/* Chevron for collapsible items */}
        {effectiveCollapsible && (
          <ChevronRight
            size={12}
            className={cn(
              "shrink-0 ml-2 text-muted-foreground transition-transform duration-200",
              "group-hover:text-foreground",
              isExpanded && "rotate-90",
            )}
          />
        )}
      </div>
      {/* Expanded content */}
      {effectiveCollapsible && isExpanded && (
        <div
          data-testid="expanded-content"
          className={cn(
            "mt-1 mb-1.5 p-2 rounded-md text-xs leading-relaxed max-h-44 overflow-y-auto whitespace-pre-wrap break-all",
            isThinking
              ? "bg-purple-500/5 border border-purple-500/20 text-muted-foreground italic"
              : "bg-black/30 border border-border font-mono text-muted-foreground",
          )}
        >
          {isThinking ? thinkingBody : displayContent}
        </div>
      )}
    </div>
  );
}
