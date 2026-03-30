import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentEventMetadata } from "@/types/im";

interface ToolCallBlockProps {
  callMetadata: AgentEventMetadata;
  resultMetadata: AgentEventMetadata;
  resultContent: string;
}

export function ToolCallBlock({
  callMetadata,
  resultMetadata,
  resultContent,
}: ToolCallBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toolName = callMetadata.toolName ?? "Unknown tool";
  const resultFailed = resultMetadata.status === "failed";
  const resultSummary =
    resultContent.length > 80
      ? resultContent.slice(0, 80) + " ..."
      : resultContent;

  return (
    <div>
      {/* Line 1: tool name */}
      <div
        className="flex items-center min-h-6 cursor-pointer group"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {/* Status dot */}
        <div
          className={cn(
            "w-2 h-2 rounded-full shrink-0 mr-[26px]",
            resultFailed ? "bg-red-500" : "bg-emerald-500",
          )}
        />
        {/* Label */}
        <span
          className={cn(
            "text-xs font-semibold shrink-0 w-[72px]",
            resultFailed ? "text-red-500" : "text-emerald-500",
          )}
        >
          Calling
        </span>
        {/* Tool name */}
        <span className="text-xs truncate flex-1 min-w-0 ml-2 font-mono text-foreground/80">
          {toolName}
        </span>
        {/* Result status indicator */}
        <span
          className={cn(
            "text-xs shrink-0 ml-2",
            resultFailed ? "text-red-400" : "text-emerald-500/70",
          )}
        >
          {resultFailed ? "\u2718" : "\u2714"}
        </span>
        {/* Chevron */}
        <ChevronRight
          size={12}
          className={cn(
            "shrink-0 ml-2 text-muted-foreground transition-transform duration-200",
            "group-hover:text-foreground",
            isExpanded && "rotate-90",
          )}
        />
      </div>

      {/* Line 2: result summary */}
      {!isExpanded && resultSummary && (
        <div
          className="flex items-center min-h-5 cursor-pointer"
          onClick={() => setIsExpanded(true)}
        >
          <div className="w-2 shrink-0 mr-[26px]" />
          <span
            className={cn(
              "text-xs font-semibold shrink-0 w-[72px]",
              resultFailed ? "text-red-500" : "text-emerald-500",
            )}
          >
            Result
          </span>
          <span
            className={cn(
              "text-xs truncate flex-1 min-w-0 ml-2 font-mono",
              resultFailed ? "text-red-400" : "text-foreground/80",
            )}
          >
            {resultSummary}
          </span>
        </div>
      )}

      {/* Expanded: result content */}
      {isExpanded && (
        <div
          className={cn(
            "mt-1 mb-1.5 p-2 rounded-md text-xs leading-relaxed max-h-44 overflow-y-auto whitespace-pre-wrap break-all",
            resultFailed
              ? "bg-red-500/5 border border-red-500/20 text-red-300"
              : "bg-black/30 border border-border font-mono text-muted-foreground",
          )}
        >
          {resultContent}
        </div>
      )}
    </div>
  );
}
