import { useState, useEffect } from "react";
import {
  AlertCircle,
  Brain,
  ChevronRight,
  ClipboardList,
  Flag,
  List,
  MousePointerClick,
  PenLine,
  Play,
  Wrench,
  type LucideIcon,
} from "lucide-react";
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

// Status drives color (yellow while running → green on success, red on
// failure, amber on timeout). The same classes are applied to both the
// event icon and its label so each row reads as one color-coded unit.
const LABEL_CLASSES: Record<AgentEventMetadata["status"], string> = {
  running: "text-yellow-400",
  completed: "text-emerald-500",
  failed: "text-red-500",
  resolved: "text-emerald-500",
  timeout: "text-amber-500",
  cancelled: "text-red-500",
};

// Event type drives the icon. Types that never actually render (like
// turn_separator) still need a placeholder so TypeScript can keep the
// record exhaustive.
const EVENT_ICONS: Record<AgentEventMetadata["agentEventType"], LucideIcon> = {
  thinking: Brain,
  writing: PenLine,
  tool_call: Wrench,
  tool_result: ClipboardList,
  agent_start: Play,
  agent_end: Flag,
  error: AlertCircle,
  turn_separator: Brain,
  a2ui_surface_update: List,
  a2ui_response: MousePointerClick,
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
 * Build the label for a thinking event. Examples:
 *   streaming  → "Thinking 1m 4s"  / "思考中 1 分 4 秒"
 *   completed  → "Thought for 2m 12s" / "思考用时 2 分 12 秒"
 *   no duration (edge case) → "Thinking" / "思考中"
 *
 * While streaming with a valid `startedAt`, the duration starts at 0s and
 * ticks upward (the caller re-renders on a timer). We intentionally no
 * longer gate on `elapsed > 0` so the label always reflects elapsed time
 * from the moment thinking begins, rather than jumping in after the first
 * second.
 *
 * Token counts are intentionally omitted — many providers surface only
 * summarized thinking, so a raw token number next to a short summary was
 * confusing. Duration is unambiguous.
 */
export function buildThinkingStats(
  metadata: AgentEventMetadata,
  isStreaming: boolean,
  t: ChannelTFunction,
  nowMs: number = Date.now(),
): string {
  let durationText: string | null = null;

  if (isStreaming && metadata.startedAt) {
    const startTs = new Date(metadata.startedAt).getTime();
    if (!Number.isNaN(startTs)) {
      const elapsed = Math.max(0, nowMs - startTs);
      durationText = formatDuration(elapsed, t);
    }
  } else if (
    !isStreaming &&
    typeof metadata.durationMs === "number" &&
    metadata.durationMs >= 0
  ) {
    durationText = formatDuration(metadata.durationMs, t);
  }

  if (durationText === null) {
    return t("tracking.thinking.label");
  }
  return isStreaming
    ? t("tracking.thinking.thinkingWithDuration", { stats: durationText })
    : t("tracking.thinking.thoughtForDuration", { stats: durationText });
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

  // Icon stays status-colored so a glance at the left gutter conveys the
  // outcome. The label reads as gray secondary metadata — except on
  // failure, where muting the copy would hide a real error. Running still
  // pulses on both icon and label to keep the in-flight state obvious.
  const iconColorClass = LABEL_CLASSES[status];
  const labelColorClass =
    status === "failed" || status === "cancelled"
      ? "text-red-500"
      : "text-foreground/70";
  const EventIcon = EVENT_ICONS[metadata.agentEventType];

  // Thinking defaults to collapsible even when the `collapsible` prop
  // isn't explicitly set (the thinking body lives inside the expandable
  // panel below).
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
        {/* Event icon. Shape = event type; color = status. mr-[23px]
            lines the label text start up with the message text in the
            surrounding message rows (see note on paddingLeft in
            MessageItem.tsx). */}
        <EventIcon
          data-testid="event-icon"
          size={14}
          strokeWidth={2.25}
          className={cn(
            "shrink-0 mr-[23px]",
            iconColorClass,
            status === "running" && "animate-pulse",
          )}
        />

        {/* Label */}
        <span
          className={cn(
            "text-xs font-semibold shrink-0",
            isThinking ? "whitespace-nowrap" : "w-[72px]",
            labelColorClass,
            status === "running" && "animate-pulse",
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
