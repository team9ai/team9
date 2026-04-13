import { useState, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cn } from "@/lib/utils";
import { getLabelKey, type StatusType } from "@/config/toolLabels";
import type { AgentEventMetadata } from "@/types/im";

// Namespace-scoped TFunction used by the formatDuration / buildThinkingStats
// helpers. Typing the helpers against the `channel` namespace keeps the
// i18next type autocomplete happy while still letting callers pass the
// namespace-specific `t` returned from `useTranslation("channel")`.
type ChannelTFunction = TFunction<"channel">;

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

// i18n key mapping for each agent event type. The actual copy is resolved
// through react-i18next so both en and zh work (see tracking.eventLabels in
// channel.json). Some entries are effectively dead code — `thinking` takes a
// dedicated buildThinkingStats path, `tool_call` is resolved via getLabelKey
// in this file, and `turn_separator` returns null before the label is used —
// but keeping the map exhaustive keeps TypeScript happy and avoids silent
// regressions if any of those paths change in the future.
const EVENT_LABEL_KEYS: Record<AgentEventMetadata["agentEventType"], string> = {
  thinking: "tracking.eventLabels.thinking",
  writing: "tracking.eventLabels.writing",
  tool_call: "tracking.eventLabels.toolCall",
  tool_result: "tracking.eventLabels.toolResult",
  agent_start: "tracking.eventLabels.agentStart",
  agent_end: "tracking.eventLabels.agentEnd",
  error: "tracking.eventLabels.error",
  turn_separator: "tracking.eventLabels.turn",
  a2ui_surface_update: "tracking.eventLabels.choices",
  a2ui_response: "tracking.eventLabels.selected",
};

function truncateLine(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen);
}

/**
 * Format a duration in milliseconds into a human-readable localized string.
 * - < 60 seconds: e.g. "45s" (en) / "45 秒" (zh)
 * - >= 60 seconds: e.g. "2m 3s" (en) / "2 分 3 秒" (zh)
 * Millisecond values are floored to whole seconds and clamped to 0.
 *
 * Exposed as a helper so unit tests can exercise the formatting logic
 * directly without mounting a component tree.
 */
export function formatDuration(ms: number, t: ChannelTFunction): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) {
    return t("tracking.thinking.seconds", { count: totalSeconds });
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return t("tracking.thinking.minutesSeconds", { minutes, seconds });
}

/**
 * Build the stats label for a thinking event. Examples (en):
 *   "Thinking (1200 tokens, 2m 3s)"
 *   "Thinking (1200 tokens)"
 *   "Thinking (2m 3s)"
 *   "Thinking"
 *
 * When `isStreaming` and `metadata.startedAt` is present, the duration is
 * computed live from the current clock. The caller is expected to re-render
 * on a timer to refresh this value.
 */
export function buildThinkingStats(
  metadata: AgentEventMetadata,
  isStreaming: boolean,
  t: ChannelTFunction,
  nowMs: number = Date.now(),
): string {
  const parts: string[] = [];

  // Tokens: prefer totalTokens, fall back to outputTokens.
  const tokens =
    typeof metadata.totalTokens === "number"
      ? metadata.totalTokens
      : metadata.outputTokens;
  if (typeof tokens === "number" && tokens > 0) {
    parts.push(t("tracking.thinking.tokens", { count: tokens }));
  }

  // Duration: while streaming, compute from startedAt; otherwise use
  // the final durationMs captured on completion.
  if (isStreaming && metadata.startedAt) {
    const startTs = new Date(metadata.startedAt).getTime();
    if (!Number.isNaN(startTs)) {
      const elapsed = nowMs - startTs;
      if (elapsed > 0) {
        parts.push(formatDuration(elapsed, t));
      }
    }
  } else if (
    typeof metadata.durationMs === "number" &&
    metadata.durationMs > 0
  ) {
    parts.push(formatDuration(metadata.durationMs, t));
  }

  if (parts.length === 0) return t("tracking.thinking.label");
  return t("tracking.thinking.labelWithStats", { stats: parts.join(", ") });
}

/**
 * Map an AgentEventMetadata status to the StatusType expected by getLabelKey().
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
  const { t } = useTranslation("channel");
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

  // `t` values we pass to the next two blocks are computed at runtime, so they
  // aren't literals known to i18next's resource typing. The loose cast bypasses
  // the strict key narrowing and lets the `t(key, options)` overload accept
  // the dynamic keys + interpolation values.
  const loosenedT = t as (
    key: string,
    options?: Record<string, unknown>,
  ) => string;

  // For tool_call events, use the localized label system from toolLabels.
  // This replaces the hardcoded "Calling" label with tool-specific copy
  // (e.g. "Sending message" / "Message sent" / "Failed to send message").
  let toolCallLabel: string | null = null;
  if (metadata.agentEventType === "tool_call") {
    const descriptor = getLabelKey(
      "invoke_tool",
      metadata.toolName,
      toLabelStatus(status),
    );
    toolCallLabel = loosenedT(descriptor.key, descriptor.values);
  }

  // Resolve the event-type label via i18n. The key is a dynamic lookup from
  // EVENT_LABEL_KEYS.
  const eventTypeLabel = EVENT_LABEL_KEYS[metadata.agentEventType]
    ? loosenedT(EVENT_LABEL_KEYS[metadata.agentEventType])
    : metadata.agentEventType;

  const label = isThinking
    ? buildThinkingStats(metadata, isStreaming, t)
    : (toolCallLabel ?? eventTypeLabel);

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
