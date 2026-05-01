import { useState } from "react";
import { ChevronRight, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getLabelKey } from "@/config/toolLabels";
import { useFullContent } from "@/hooks/useMessages";
import { buildToolDisplayState } from "@/lib/tool-events";
import type { AgentEventMetadata, Message } from "@/types/im";

interface ToolCallBlockProps {
  callMetadata: AgentEventMetadata;
  resultMetadata?: AgentEventMetadata;
  resultContent?: string;
  resultMessage?: Pick<
    Message,
    "id" | "type" | "content" | "isTruncated" | "fullContentLength"
  >;
}

function formatJson(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

export function ToolCallBlock({
  callMetadata,
  resultMetadata,
  resultContent,
  resultMessage,
}: ToolCallBlockProps) {
  const { t } = useTranslation("channel");
  const [isExpanded, setIsExpanded] = useState(false);

  const fullContentTargetId =
    resultMetadata?.fullContentMessageId ??
    (resultMessage?.isTruncated ? resultMessage.id : undefined);
  const shouldFetchFullContent = isExpanded && !!fullContentTargetId;
  const { data: fullContentData } = useFullContent(
    fullContentTargetId,
    shouldFetchFullContent,
  );
  const effectiveResultContent =
    fullContentData?.content ?? resultContent ?? resultMessage?.content ?? "";
  const displayState = buildToolDisplayState({
    callMetadata,
    resultMetadata,
    resultContent: effectiveResultContent,
  });
  const labelStatus = displayState.status;

  const toolName = displayState.toolName;
  const paramsSummary = displayState.argsSummary;
  const displayLine = paramsSummary
    ? `${toolName}(${paramsSummary})`
    : toolName;
  const unwrapped = displayState.resultText;
  const isRunning = displayState.isRunning;
  const isError = displayState.isError;
  const hasResultContent = unwrapped !== "";

  // Friendly label from toolLabels (e.g. "Sending message", "Message sent",
  // "Failed to send message"). The raw key/values come from getLabelKey and
  // the actual copy is resolved via react-i18next so both en and zh work.
  const labelDescriptor = getLabelKey(
    "invoke_tool",
    callMetadata.toolName,
    labelStatus,
  );
  // `labelDescriptor.key` is computed dynamically, so it doesn't match the
  // literal keys in i18next's resource typing. Cast `t` to a loose signature
  // so we can pass the dynamic key + interpolation values without tripping
  // on the narrow overload typings.
  const label = (
    t as (key: string, options?: Record<string, unknown>) => string
  )(labelDescriptor.key, labelDescriptor.values);

  // Icon color follows status: yellow while running (pulsing), red on
  // failure, emerald on success. Matches TrackingEventItem so tool call
  // rows sit seamlessly alongside the other event rows.
  const iconColorClass = isError
    ? "text-red-500"
    : isRunning
      ? "text-yellow-400"
      : "text-emerald-500";

  // Label uses a muted gray so the icon/indicator carry the status signal
  // without making failed rows feel visually louder than normal tool output.
  const labelColorClass = "text-foreground/70";

  // Success/failure indicator tail icon. Hidden while running.
  const indicatorChar =
    displayState.indicator === "cross"
      ? "\u2718"
      : displayState.indicator === "check"
        ? "\u2714"
        : "";
  const indicatorColorClass = isError ? "text-red-400" : "text-emerald-500/70";

  return (
    <div>
      {/* Single-line tool call display */}
      <div
        className="flex items-center min-h-6 cursor-pointer group"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Wrench icon — pulses yellow while the call is in flight. */}
        <Wrench
          data-testid="event-icon"
          size={14}
          strokeWidth={2.25}
          className={cn(
            "shrink-0 mr-[23px]",
            iconColorClass,
            isRunning && "animate-pulse",
          )}
        />
        {/* Friendly label */}
        <span
          className={cn(
            "text-xs font-semibold shrink-0 whitespace-nowrap",
            labelColorClass,
            isRunning && "animate-pulse",
          )}
        >
          {label}
        </span>
        {/* Tool name + params summary */}
        <span
          className={cn(
            "text-xs truncate flex-1 min-w-0 ml-2 font-mono",
            "text-foreground/80",
          )}
        >
          {displayLine}
        </span>
        {/* Result status indicator (checkmark / cross) */}
        {indicatorChar && (
          <span className={cn("text-xs shrink-0 ml-2", indicatorColorClass)}>
            {indicatorChar}
          </span>
        )}
        {/* Chevron (always present so users can always toggle) */}
        <ChevronRight
          size={12}
          className={cn(
            "shrink-0 ml-2 text-muted-foreground transition-transform duration-200",
            "group-hover:text-foreground",
            isExpanded && "rotate-90",
          )}
        />
      </div>

      {/* Expanded: full args + result (including error detail on failure) */}
      {isExpanded && (
        <div className="mt-1 mb-1.5 space-y-2">
          {displayState.argsText && (
            <div>
              <span className="text-xs font-semibold text-muted-foreground">
                {t("tracking.toolCall.argsLabel")}
              </span>
              <pre
                className={cn(
                  "mt-0.5 p-2 rounded-md text-xs leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap break-all",
                  // Theme-aware code-block surface — the old bg-black/20
                  // rendered as muddy gray in light mode and was hard to
                  // read against text-muted-foreground.
                  "bg-muted/60 border border-border font-mono text-foreground/85",
                )}
              >
                {displayState.argsText}
              </pre>
            </div>
          )}
          {hasResultContent && (
            <div>
              <span
                className={cn(
                  "text-xs font-semibold",
                  isError ? "text-red-500" : "text-emerald-500",
                )}
              >
                {t("tracking.toolCall.resultLabel")}
              </span>
              <pre
                className={cn(
                  "mt-0.5 p-2 rounded-md text-xs leading-relaxed max-h-44 overflow-y-auto whitespace-pre-wrap break-all font-mono",
                  isError
                    ? "bg-red-500/5 border border-red-500/20 text-red-700 dark:text-red-300"
                    : "bg-muted/60 border border-border text-foreground/85",
                )}
              >
                {formatJson(unwrapped)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
