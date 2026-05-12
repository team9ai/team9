import { useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  Expand,
  Loader2,
  Wrench,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { getLabelKey } from "@/config/toolLabels";
import { useFullContent } from "@/hooks/useMessages";
import { buildToolDisplayState } from "@/lib/tool-events";
import type {
  CommandExecutionDisplay,
  TodoStatus,
  TodoWriteDisplay,
} from "@/lib/tool-events";
import type { AgentEventMetadata, Message } from "@/types/im";

interface ToolCallBlockProps {
  callMetadata: AgentEventMetadata;
  resultMetadata?: AgentEventMetadata;
  resultContent?: string;
  resultMessage?: Pick<
    Message,
    "id" | "content" | "isTruncated" | "fullContentLength"
  > &
    Partial<Pick<Message, "type">>;
}

function formatJson(text: string): string {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "string") return parsed;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

function formatStructuredJson(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return undefined;
  }
}

function getRunCommandTargetKey(
  targetKind: CommandExecutionDisplay["targetKind"],
) {
  switch (targetKind) {
    case "local":
      return "tracking.toolCall.runCommand.local";
    case "cloud-computer":
      return "tracking.toolCall.runCommand.cloudComputer";
    case "cloud-sandbox":
      return "tracking.toolCall.runCommand.cloudSandbox";
    default:
      return "tracking.toolCall.runCommand.backend";
  }
}

function RunCommandSummary({
  execution,
  t,
}: {
  execution: CommandExecutionDisplay;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <>
      <span>
        {t(getRunCommandTargetKey(execution.targetKind), {
          name: execution.targetName ?? execution.backend ?? "",
        })}
      </span>
      <code className="ml-1 rounded bg-muted px-1 py-0.5 font-mono text-[0.92em] text-foreground">
        {execution.command}
      </code>
    </>
  );
}

function LoadedToolsSummary({
  names,
  t,
}: {
  names: string[];
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <>
      <span>{t("tracking.toolCall.loadedTools")}</span>
      <span className="ml-1">
        {names.map((name, index) => (
          <span key={`${name}-${index}`}>
            {index > 0 ? ", " : ""}
            <em>{name}</em>
          </span>
        ))}
      </span>
    </>
  );
}

function TodoWriteSummary({
  todo,
  t,
}: {
  todo: TodoWriteDisplay;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <>
      <span>
        {t("tracking.toolCall.todoSummary", {
          total: todo.total,
        })}
      </span>
    </>
  );
}

function getTodoStatusLabelKey(status: TodoStatus): string {
  switch (status) {
    case "in_progress":
      return "tracking.toolCall.todoStatus.inProgress";
    case "completed":
      return "tracking.toolCall.todoStatus.completed";
    default:
      return "tracking.toolCall.todoStatus.pending";
  }
}

function TodoStatusIcon({
  label,
  status,
}: {
  label: string;
  status: TodoStatus;
}) {
  const icon =
    status === "completed" ? (
      <CheckCircle2 className="size-3.5 text-emerald-600" />
    ) : status === "in_progress" ? (
      <Loader2 className="size-3.5 animate-spin text-amber-600" />
    ) : (
      <Circle className="size-3.5 text-muted-foreground" />
    );

  return (
    <span
      aria-label={label}
      className="shrink-0"
      data-testid="todo-write-status-icon"
      title={label}
    >
      {icon}
    </span>
  );
}

function TodoWriteStatusList({
  todo,
  t,
}: {
  todo: TodoWriteDisplay;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <div className="ml-[37px] mt-1 space-y-0.5 rounded-md border border-border/60 bg-muted/30 p-1.5">
      {todo.items.map((item, index) => (
        <div
          key={`${item.status}-${item.content}-${index}`}
          className="flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5"
          data-testid="todo-write-item"
        >
          <TodoStatusIcon
            label={t(getTodoStatusLabelKey(item.status))}
            status={item.status}
          />
          <div
            className={cn(
              "min-w-0 flex-1 truncate text-[11px] leading-4 text-foreground/85",
              item.status === "completed" &&
                "text-muted-foreground line-through",
            )}
            data-testid="todo-write-title"
          >
            {item.content}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExpandablePre({
  className,
  label,
  rawValue,
  t,
  value,
}: {
  className: string;
  label: string;
  rawValue?: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  value: string;
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const rawText = rawValue ?? value;
  const formattedJson = formatStructuredJson(rawText);
  const fullscreenValue = formattedJson && !showRaw ? formattedJson : rawText;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t("tracking.toolCall.fullscreen", { label })}
        title={t("tracking.toolCall.fullscreen", { label })}
        className={cn(
          "absolute right-1.5 top-2 z-10 rounded border border-border bg-background/80 p-1",
          "text-muted-foreground shadow-sm backdrop-blur-sm hover:bg-muted hover:text-foreground",
        )}
        onClick={(event) => {
          event.stopPropagation();
          setShowRaw(false);
          setIsFullscreen(true);
        }}
      >
        <Expand size={12} />
      </button>
      <pre className={cn(className, "pr-9")}>{value}</pre>
      {isFullscreen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
          className="fixed inset-0 z-50 bg-black/60 p-6 pt-12 backdrop-blur-sm"
          onClick={() => setIsFullscreen(false)}
        >
          <div
            data-fullscreen-panel
            className="flex h-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
              <span className="text-xs font-semibold text-muted-foreground">
                {label}
              </span>
              <div className="flex items-center gap-2">
                {formattedJson && (
                  <button
                    type="button"
                    className="rounded border border-border px-2 py-1 text-[11px] leading-none text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setShowRaw((value) => !value)}
                  >
                    {showRaw
                      ? t("tracking.toolCall.formattedJson")
                      : t("tracking.toolCall.rawJson")}
                  </button>
                )}
                <button
                  type="button"
                  aria-label={t("tracking.toolCall.closeFullscreen")}
                  className="rounded border border-border p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => setIsFullscreen(false)}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <pre
              className={cn(
                className,
                "m-0 min-h-0 flex-1 overflow-auto rounded-none border-0 !max-h-none",
              )}
            >
              {fullscreenValue}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function StreamBlock({
  label,
  value,
  tone,
  emptyText,
  t,
}: {
  label: "stdout" | "stderr" | "exitCode";
  value: string;
  tone: "neutral" | "error";
  emptyText: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const hasOutput = value.trim() !== "";
  const preClassName = cn(
    "mt-0.5 p-2 rounded-md text-xs leading-relaxed max-h-36 overflow-y-auto whitespace-pre-wrap break-all font-mono",
    tone === "error" && hasOutput
      ? "bg-red-500/5 border border-red-500/20 text-red-700 dark:text-red-300"
      : "bg-muted/60 border border-border text-foreground/85",
    !hasOutput && "text-muted-foreground",
  );

  return (
    <div>
      <span
        className={cn(
          "text-xs font-semibold",
          tone === "error" && hasOutput
            ? "text-red-500"
            : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <ExpandablePre
        className={preClassName}
        label={label}
        t={t}
        value={hasOutput ? value : emptyText}
      />
    </div>
  );
}

function RawToolDetails({
  argsText,
  resultText,
  isError,
  t,
}: {
  argsText: string;
  resultText: string;
  isError: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const argsLabel = t("tracking.toolCall.argsLabel");
  const resultLabel = t("tracking.toolCall.resultLabel");

  return (
    <>
      {argsText && (
        <div>
          <span className="text-xs font-semibold text-muted-foreground">
            {argsLabel}
          </span>
          <ExpandablePre
            className={cn(
              "mt-0.5 p-2 rounded-md text-xs leading-relaxed max-h-32 overflow-y-auto whitespace-pre-wrap break-all",
              "bg-muted/60 border border-border font-mono text-foreground/85",
            )}
            label={argsLabel}
            t={t}
            value={argsText}
          />
        </div>
      )}
      {resultText !== "" && (
        <div>
          <span
            className={cn(
              "text-xs font-semibold",
              isError ? "text-red-500" : "text-emerald-500",
            )}
          >
            {resultLabel}
          </span>
          <ExpandablePre
            className={cn(
              "mt-0.5 p-2 rounded-md text-xs leading-relaxed max-h-44 overflow-y-auto whitespace-pre-wrap break-all font-mono",
              isError
                ? "bg-red-500/5 border border-red-500/20 text-red-700 dark:text-red-300"
                : "bg-muted/60 border border-border text-foreground/85",
            )}
            label={resultLabel}
            rawValue={resultText}
            t={t}
            value={formatJson(resultText)}
          />
        </div>
      )}
    </>
  );
}

export function ToolCallBlock({
  callMetadata,
  resultMetadata,
  resultContent,
  resultMessage,
}: ToolCallBlockProps) {
  const { t } = useTranslation("channel");
  const [isExpanded, setIsExpanded] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);

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
  const commandExecution = displayState.commandExecution;
  const isRunCommandDisplay = !!commandExecution;
  const loadedToolNames = displayState.loadedToolNames;
  const isLoadToolsDisplay = !!loadedToolNames;
  const todoWrite = displayState.todoWrite;
  const isTodoWriteDisplay = !!todoWrite;
  const hasCommandStdout = !!commandExecution?.stdout.trim();
  const hasCommandStderr = !!commandExecution?.stderr.trim();
  const commandExitCode = commandExecution?.exitCode;
  const shouldShowCommandExitCode =
    commandExitCode !== undefined &&
    ((!hasCommandStdout && !hasCommandStderr) || commandExitCode !== "0");
  const translate = t as (
    key: string,
    options?: Record<string, unknown>,
  ) => string;

  // Friendly label from toolLabels (e.g. "Sending message", "Message sent",
  // "Failed to send message"). The raw key/values come from getLabelKey and
  // the actual copy is resolved via react-i18next so both en and zh work.
  const labelDescriptor = getLabelKey(
    isLoadToolsDisplay ? "load_tools" : "invoke_tool",
    displayState.toolName,
    labelStatus,
  );
  // `labelDescriptor.key` is computed dynamically, so it doesn't match the
  // literal keys in i18next's resource typing. Cast `t` to a loose signature
  // so we can pass the dynamic key + interpolation values without tripping
  // on the narrow overload typings.
  const label = translate(labelDescriptor.key, labelDescriptor.values);

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
        {isRunCommandDisplay ? (
          <span
            className={cn(
              "text-xs truncate flex-1 min-w-0 text-foreground/80",
              isRunning && "animate-pulse",
            )}
          >
            <RunCommandSummary execution={commandExecution} t={translate} />
          </span>
        ) : (
          <>
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
              {isLoadToolsDisplay ? (
                <LoadedToolsSummary names={loadedToolNames} t={translate} />
              ) : isTodoWriteDisplay ? (
                <TodoWriteSummary todo={todoWrite} t={translate} />
              ) : (
                displayLine
              )}
            </span>
          </>
        )}
        {isRunCommandDisplay && (
          <button
            type="button"
            className={cn(
              "ml-2 shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] leading-none font-mono",
              "text-muted-foreground hover:text-foreground hover:bg-muted",
              showRawJson && "bg-muted text-foreground",
            )}
            aria-pressed={showRawJson}
            onClick={(event) => {
              event.stopPropagation();
              setShowRawJson((value) => !value);
              setIsExpanded(true);
            }}
          >
            json
          </button>
        )}
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

      {isTodoWriteDisplay && (
        <TodoWriteStatusList todo={todoWrite} t={translate} />
      )}

      {/* Expanded: full args + result (including error detail on failure) */}
      {isExpanded && (
        <div className="mt-1 mb-1.5 space-y-2">
          {isRunCommandDisplay && !showRawJson ? (
            <>
              {hasCommandStdout && (
                <StreamBlock
                  label="stdout"
                  value={commandExecution.stdout}
                  tone="neutral"
                  emptyText={translate("tracking.toolCall.emptyStream")}
                  t={translate}
                />
              )}
              {hasCommandStderr && (
                <StreamBlock
                  label="stderr"
                  value={commandExecution.stderr}
                  tone="error"
                  emptyText={translate("tracking.toolCall.emptyStream")}
                  t={translate}
                />
              )}
              {shouldShowCommandExitCode && (
                <StreamBlock
                  label="exitCode"
                  value={commandExitCode ?? ""}
                  tone={commandExitCode === "0" ? "neutral" : "error"}
                  emptyText={translate("tracking.toolCall.emptyStream")}
                  t={translate}
                />
              )}
            </>
          ) : (
            <RawToolDetails
              argsText={displayState.argsText}
              resultText={hasResultContent ? unwrapped : ""}
              isError={isError}
              t={translate}
            />
          )}
        </div>
      )}
    </div>
  );
}
