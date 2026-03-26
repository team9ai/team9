import { cn } from "@/lib/utils";
import type { AgentEventMetadata } from "@/types/im";

interface TrackingEventItemProps {
  metadata: AgentEventMetadata;
  content: string;
  /** Whether this item is actively streaming */
  isStreaming?: boolean;
  /** Whether to show in compact mode (inline card) vs full mode (modal) */
  compact?: boolean;
}

const STATUS_DOT_CLASSES: Record<AgentEventMetadata["status"], string> = {
  running: "bg-emerald-500 animate-pulse",
  completed: "bg-emerald-500",
  failed: "bg-red-500",
};

const LABEL_CLASSES: Record<AgentEventMetadata["status"], string> = {
  running: "text-yellow-400",
  completed: "text-emerald-500",
  failed: "text-red-500",
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
};

export function TrackingEventItem({
  metadata,
  content,
  isStreaming = false,
  compact = true,
}: TrackingEventItemProps) {
  const status = isStreaming ? "running" : metadata.status;
  const label =
    EVENT_LABELS[metadata.agentEventType] ?? metadata.agentEventType;
  const displayContent =
    metadata.agentEventType === "tool_call" && metadata.toolName
      ? metadata.toolName
      : content;

  return (
    <div className="flex items-center gap-2.5 min-h-6">
      {/* Status dot */}
      <div
        className={cn(
          "w-2 h-2 rounded-full shrink-0",
          STATUS_DOT_CLASSES[status],
        )}
      />
      {/* Label */}
      <span
        className={cn("text-xs font-semibold shrink-0", LABEL_CLASSES[status])}
      >
        {label}
      </span>
      {/* Content */}
      <span
        className={cn(
          "text-xs truncate",
          metadata.agentEventType === "tool_call" ||
            metadata.agentEventType === "tool_result"
            ? "font-mono text-foreground/80"
            : "text-muted-foreground",
        )}
      >
        {displayContent}
        {isStreaming && (
          <span className="inline-block w-0.5 h-3.5 bg-yellow-400 animate-pulse ml-0.5 align-text-bottom" />
        )}
      </span>
    </div>
  );
}
