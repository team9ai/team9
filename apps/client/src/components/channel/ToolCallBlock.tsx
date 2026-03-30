import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
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

function summarizeArgs(args: Record<string, unknown>): string {
  for (const value of Object.values(args)) {
    if (typeof value === "string" && value.length > 0) {
      return value.length > 60 ? value.slice(0, 57) + "..." : value;
    }
  }
  const json = JSON.stringify(args);
  if (json.length <= 60) return json;
  return json.slice(0, 57) + "...";
}

export function ToolCallBlock({
  callMetadata,
  resultMetadata,
  resultContent,
}: ToolCallBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const toolName = callMetadata.toolName ?? "Unknown tool";
  const toolArgs = callMetadata.toolArgs;
  const resultFailed = resultMetadata.status === "failed";
  const unwrapped = unwrapResultContent(resultContent);
  const resultSummary =
    unwrapped.length > 80 ? unwrapped.slice(0, 80) + " ..." : unwrapped;

  // Collapsed: toolName(argsSummary) or just toolName
  const callSummary = toolArgs
    ? `${toolName}(${summarizeArgs(toolArgs)})`
    : toolName;

  return (
    <div>
      {/* Line 1: tool call */}
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
        {/* Tool name + args summary */}
        <span className="text-xs truncate flex-1 min-w-0 ml-2 font-mono text-foreground/80">
          {callSummary}
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

      {/* Line 2: result summary (collapsed only) */}
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

      {/* Expanded: args + result */}
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
          <div>
            <span
              className={cn(
                "text-xs font-semibold",
                resultFailed ? "text-red-500" : "text-emerald-500",
              )}
            >
              Result
            </span>
            <pre
              className={cn(
                "mt-0.5 p-2 rounded-md text-xs leading-relaxed max-h-44 overflow-y-auto whitespace-pre-wrap break-all",
                resultFailed
                  ? "bg-red-500/5 border border-red-500/20 text-red-300"
                  : "bg-black/30 border border-border font-mono text-muted-foreground",
              )}
            >
              {formatJson(unwrapped)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
