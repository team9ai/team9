import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
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

function truncateLine(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen);
}

export function TrackingEventItem({
  metadata,
  content,
  isStreaming = false,
  compact: _compact = true,
  collapsible = false,
}: TrackingEventItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const status = isStreaming ? "running" : metadata.status;
  const label =
    EVENT_LABELS[metadata.agentEventType] ?? metadata.agentEventType;

  const isThinking = metadata.agentEventType === "thinking";
  const labelColorClass =
    isThinking && status !== "failed"
      ? "text-purple-400"
      : LABEL_CLASSES[status];

  const displayContent =
    metadata.agentEventType === "tool_call" && metadata.toolName
      ? metadata.toolName
      : content;

  const summaryContent = collapsible
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
          collapsible && "cursor-pointer group",
        )}
        onClick={collapsible ? () => setIsExpanded(!isExpanded) : undefined}
      >
        {/* Status dot */}
        <div
          className={cn(
            "w-2 h-2 rounded-full shrink-0 mr-[26px]",
            STATUS_DOT_CLASSES[status],
          )}
        />
        {/* Label */}
        <span
          className={cn(
            "text-xs font-semibold shrink-0 w-[72px]",
            labelColorClass,
          )}
        >
          {label}
        </span>
        {/* Content */}
        <span
          className={cn(
            "text-xs truncate flex-1 min-w-0 ml-2",
            metadata.agentEventType === "tool_call" ||
              metadata.agentEventType === "tool_result"
              ? "font-mono text-foreground/80"
              : isThinking
                ? "text-muted-foreground italic"
                : "text-muted-foreground",
          )}
        >
          {summaryContent}
          {isStreaming && (
            <span className="inline-block w-0.5 h-3.5 bg-yellow-400 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </span>
        {/* Chevron for collapsible items */}
        {collapsible && (
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
      {collapsible && isExpanded && (
        <div
          data-testid="expanded-content"
          className={cn(
            "mt-1 mb-1.5 p-2 rounded-md text-xs leading-relaxed max-h-44 overflow-y-auto whitespace-pre-wrap break-all",
            isThinking
              ? "bg-purple-500/5 border border-purple-500/20 text-muted-foreground italic"
              : "bg-black/30 border border-border font-mono text-muted-foreground",
          )}
        >
          {displayContent}
        </div>
      )}
    </div>
  );
}
