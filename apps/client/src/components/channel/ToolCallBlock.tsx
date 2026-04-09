import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { getLabel, type StatusType } from "@/config/toolLabels";
import { formatParams } from "@/config/toolParamConfig";
import type { AgentEventMetadata } from "@/types/im";

interface ToolCallBlockProps {
  callMetadata: AgentEventMetadata;
  resultMetadata: AgentEventMetadata;
  resultContent: string;
}

/**
 * Extract readable text from tool result content.
 * Tool results may be wrapped in `{ content: [{ type: "text", text: "..." }], details: {} }`.
 * This unwraps that structure to show the actual result text.
 */
function unwrapResultContent(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.content)) {
      const texts = parsed.content
        .filter(
          (block: { type?: string; text?: string }) => block.type === "text",
        )
        .map((block: { text: string }) => block.text);
      if (texts.length > 0) return texts.join("\n");
    }
  } catch {
    // Not JSON or unexpected structure — use raw content
  }
  return raw;
}

function formatJson(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

/**
 * Derive the label status from the runtime state.
 * - running (or missing result) => loading
 * - failed => error
 * - otherwise => success
 */
function deriveLabelStatus(
  resultMetadata: AgentEventMetadata,
  hasResultContent: boolean,
): StatusType {
  if (resultMetadata.status === "running" || !hasResultContent) {
    return "loading";
  }
  if (resultMetadata.status === "failed") {
    return "error";
  }
  return "success";
}

export function ToolCallBlock({
  callMetadata,
  resultMetadata,
  resultContent,
}: ToolCallBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toolName = callMetadata.toolName ?? "Unknown tool";
  const toolArgs = callMetadata.toolArgs;

  const hasResultContent = resultContent !== undefined && resultContent !== "";
  const labelStatus = deriveLabelStatus(resultMetadata, hasResultContent);

  const isRunning = labelStatus === "loading";
  const isError = labelStatus === "error";
  const isSuccess = labelStatus === "success";

  // Friendly label from toolLabels (e.g. "正在发送消息", "消息发送完成", "消息发送失败")
  const label = getLabel("invoke_tool", callMetadata.toolName, labelStatus);

  // Params summary using formatParams (friendly key="value" for configured tools,
  // JSON fallback for unknown tools).
  const paramsSummary = toolArgs ? formatParams(toolName, toolArgs) : "";

  // One-line display: toolName(paramsSummary) or just toolName
  const displayLine = toolArgs ? `${toolName}(${paramsSummary})` : toolName;

  const unwrapped = hasResultContent ? unwrapResultContent(resultContent) : "";

  // Status dot style - animated while running, red on failure, green on success.
  const statusDotClass = isError
    ? "bg-red-500"
    : isRunning
      ? "bg-emerald-500 animate-pulse"
      : "bg-emerald-500";

  // Label colour - red on failure, yellow while running, green on success.
  const labelColorClass = isError
    ? "text-red-500"
    : isRunning
      ? "text-yellow-400"
      : "text-emerald-500";

  // Success/failure indicator tail icon. Hidden while running.
  const indicatorChar = isError ? "\u2718" : isSuccess ? "\u2714" : "";
  const indicatorColorClass = isError ? "text-red-400" : "text-emerald-500/70";

  return (
    <div>
      {/* Single-line tool call display */}
      <div
        className="flex items-center min-h-6 cursor-pointer group"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Status dot */}
        <div
          className={cn(
            "w-2 h-2 rounded-full shrink-0 mr-[26px]",
            statusDotClass,
          )}
        />
        {/* Friendly label */}
        <span
          className={cn(
            "text-xs font-semibold shrink-0 whitespace-nowrap",
            labelColorClass,
          )}
        >
          {label}
        </span>
        {/* Tool name + params summary */}
        <span
          className={cn(
            "text-xs truncate flex-1 min-w-0 ml-2 font-mono",
            isError ? "text-red-400" : "text-foreground/80",
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
          {toolArgs && (
            <div>
              <span className="text-xs font-semibold text-muted-foreground">
                Args
              </span>
              <pre
                className={cn(
                  "mt-0.5 p-2 rounded-md text-xs leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap break-all",
                  "bg-black/20 border border-border font-mono text-muted-foreground",
                )}
              >
                {JSON.stringify(toolArgs, null, 2)}
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
                Result
              </span>
              <pre
                className={cn(
                  "mt-0.5 p-2 rounded-md text-xs leading-relaxed max-h-44 overflow-y-auto whitespace-pre-wrap break-all",
                  isError
                    ? "bg-red-500/5 border border-red-500/20 text-red-300"
                    : "bg-black/30 border border-border font-mono text-muted-foreground",
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
