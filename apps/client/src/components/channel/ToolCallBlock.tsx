import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  Cloud,
  Expand,
  Loader2,
  Monitor,
  Server,
  Wrench,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getLabelKey } from "@/config/toolLabels";
import { useFullContent } from "@/hooks/useMessages";
import { buildToolDisplayState } from "@/lib/tool-events";
import Prism from "@/lib/prism";
import { sanitizeMessageHtml } from "@/lib/sanitize";
import type {
  CommandExecutionDisplay,
  ToolResultImage,
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

type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];
type JsonValue = JsonObject | JsonArray | string | number | boolean | null;
type JsonContainer = JsonObject | JsonArray;

function parseStructuredJson(text: string): JsonContainer | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) return parsed as JsonArray;
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as JsonObject;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

const LANGUAGE_ALIASES: Record<string, string> = {
  dockerfile: "docker",
  htm: "markup",
  html: "markup",
  js: "javascript",
  jsx: "jsx",
  md: "markdown",
  py: "python",
  rb: "ruby",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "tsx",
  xml: "markup",
  yml: "yaml",
  zsh: "bash",
};

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: "bash",
  c: "c",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  dart: "dart",
  diff: "diff",
  go: "go",
  h: "c",
  hpp: "cpp",
  java: "java",
  json: "json",
  kt: "kotlin",
  kts: "kotlin",
  md: "markdown",
  php: "php",
  py: "python",
  rb: "ruby",
  rs: "rust",
  scss: "css",
  sh: "bash",
  sql: "sql",
  swift: "swift",
  ts: "typescript",
  tsx: "tsx",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

function normalizeLanguage(language?: string): string | undefined {
  if (!language) return undefined;
  const normalized = language.toLowerCase().replace(/^language-/, "");
  const aliased = LANGUAGE_ALIASES[normalized] ?? normalized;
  return Prism.languages[aliased] ? aliased : undefined;
}

function languageFromPath(path?: string): string | undefined {
  if (!path) return undefined;
  const basename = path.split(/[\\/]/).pop()?.toLowerCase();
  if (!basename) return undefined;
  if (basename === "dockerfile") return "docker";
  const extension = basename.match(/\.([a-z0-9]+)$/)?.[1];
  return normalizeLanguage(
    extension ? (LANGUAGE_BY_EXTENSION[extension] ?? extension) : undefined,
  );
}

function languageFromContent(text: string): string | undefined {
  const trimmed = text.trimStart();
  if (!trimmed) return undefined;
  if (/^#!.*\b(?:bash|zsh|sh)\b/.test(trimmed)) return "bash";
  if (/^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|WITH)\b/i.test(trimmed)) {
    return "sql";
  }
  if (/^(?:---\s*\n)?[A-Za-z0-9_.-]+\s*:\s+/m.test(trimmed)) return "yaml";
  if (/^<[\w!/?]/.test(trimmed)) return "markup";
  if (/^(?:diff --git|@@\s+-\d+)/m.test(trimmed)) return "diff";
  return undefined;
}

function extractPreviewSourceName(argsText: string): string | undefined {
  try {
    const parsed = JSON.parse(argsText) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    for (const key of ["path", "filePath", "filename", "file", "name"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function getSyntaxPreview(
  rawText: string,
  sourceName?: string,
): { language: string; text: string } | undefined {
  const language = languageFromPath(sourceName) ?? languageFromContent(rawText);
  if (!language) return undefined;
  return { language, text: rawText };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function SyntaxPreview({
  className,
  language,
  text,
}: {
  className: string;
  language: string;
  text: string;
}) {
  const highlightedHtml = useMemo(() => {
    const grammar = Prism.languages[language];
    const raw = grammar
      ? Prism.highlight(text, grammar, language)
      : escapeHtml(text);
    return sanitizeMessageHtml(raw);
  }, [language, text]);

  return (
    <pre
      data-testid="syntax-preview"
      className={cn(
        className,
        "m-0 min-h-0 flex-1 overflow-auto rounded-none border-0 !max-h-none",
      )}
    >
      <code
        className={`language-${language}`}
        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
      />
    </pre>
  );
}

function isJsonContainer(value: JsonValue): value is JsonContainer {
  return typeof value === "object" && value !== null;
}

function getJsonEntries(value: JsonContainer): Array<[string, JsonValue]> {
  if (Array.isArray(value)) {
    return value.map((item, index) => [String(index), item]);
  }
  return Object.entries(value);
}

function JsonScalar({ value }: { value: Exclude<JsonValue, JsonContainer> }) {
  if (typeof value === "string") {
    return (
      <span className="text-emerald-700 dark:text-emerald-300">
        {JSON.stringify(value)}
      </span>
    );
  }

  if (typeof value === "number") {
    return <span className="text-amber-700 dark:text-amber-300">{value}</span>;
  }

  if (typeof value === "boolean") {
    return (
      <span className="text-violet-700 dark:text-violet-300">
        {String(value)}
      </span>
    );
  }

  return <span className="text-muted-foreground">null</span>;
}

function JsonNode({
  label,
  path,
  value,
}: {
  label?: string;
  path: string;
  value: JsonValue;
}) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (!isJsonContainer(value)) {
    return (
      <div className="flex min-w-0 items-baseline gap-1">
        {label !== undefined && (
          <>
            <span className="text-sky-700 dark:text-sky-300">{label}</span>
            <span className="text-muted-foreground">:</span>
          </>
        )}
        <JsonScalar value={value} />
      </div>
    );
  }

  const entries = getJsonEntries(value);
  const isArray = Array.isArray(value);
  const openToken = isArray ? "[" : "{";
  const closeToken = isArray ? "]" : "}";
  const nodeName = label ?? "root";

  return (
    <div>
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${nodeName}`}
          className="grid size-4 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setIsExpanded((value) => !value)}
        >
          <ChevronRight
            size={12}
            className={cn(
              "transition-transform duration-150",
              isExpanded && "rotate-90",
            )}
          />
        </button>
        {label !== undefined && (
          <>
            <span className="text-sky-700 dark:text-sky-300">{label}</span>
            <span className="text-muted-foreground">:</span>
          </>
        )}
        <span className="text-foreground/80">{openToken}</span>
        {!isExpanded && entries.length > 0 && (
          <span className="text-muted-foreground">...</span>
        )}
        {!isExpanded && (
          <span className="text-foreground/80">{closeToken}</span>
        )}
        <span className="text-muted-foreground">
          {entries.length} {entries.length === 1 ? "item" : "items"}
        </span>
      </div>
      {isExpanded && (
        <>
          <div className="ml-2 border-l border-border/70 pl-4">
            {entries.map(([key, childValue]) => (
              <JsonNode
                key={`${path}.${key}`}
                label={key}
                path={`${path}.${key}`}
                value={childValue}
              />
            ))}
          </div>
          <div className="ml-4 text-foreground/80">{closeToken}</div>
        </>
      )}
    </div>
  );
}

function JsonTreeView({ data }: { data: JsonContainer }) {
  return (
    <div
      data-testid="json-tree-view"
      className="m-0 min-h-0 flex-1 overflow-auto rounded-none border-0 bg-background p-4 font-mono text-xs leading-5 text-foreground"
    >
      <JsonNode path="root" value={data} />
    </div>
  );
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
  isRunning,
  isError,
  t,
}: {
  execution: CommandExecutionDisplay;
  isRunning: boolean;
  isError: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const targetLabel = t(getRunCommandTargetKey(execution.targetKind), {
    name: execution.targetName ?? execution.backend ?? "",
  });
  const actionLabel = isRunning
    ? t("tracking.toolCall.runCommand.runningBadge")
    : isError
      ? t("tracking.toolCall.runCommand.failedBadge")
      : t("tracking.toolCall.runCommand.ranBadge");

  return (
    <>
      <span
        className={cn(
          "text-xs font-medium leading-none",
          isRunning
            ? "text-amber-600 dark:text-amber-300"
            : isError
              ? "text-red-500"
              : "text-muted-foreground",
        )}
      >
        {actionLabel}
      </span>
      <RunCommandTarget execution={execution} label={targetLabel} t={t} />
      <code className="ml-1 rounded bg-muted px-1 py-0.5 font-mono text-[0.92em] text-foreground">
        {execution.command}
      </code>
    </>
  );
}

function getRunCommandTargetTooltip(
  execution: CommandExecutionDisplay,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  switch (execution.targetKind) {
    case "cloud-sandbox":
      return t("tracking.toolCall.runCommand.cloudSandboxTooltip");
    case "local":
      return t("tracking.toolCall.runCommand.localTooltip", {
        backend: execution.backend ?? "",
      });
    case "ahand-device":
      return execution.backend ?? t("tracking.toolCall.runCommand.ahandDevice");
    default:
      return t(getRunCommandTargetKey(execution.targetKind), {
        name: execution.targetName ?? execution.backend ?? "",
      });
  }
}

function RunCommandTarget({
  execution,
  label,
  t,
}: {
  execution: CommandExecutionDisplay;
  label: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const tooltip = getRunCommandTargetTooltip(execution, t);
  const iconClassName = "size-3.5 shrink-0";
  const wrapperClassName =
    "inline-flex shrink-0 items-center gap-0.5 align-[-2px] text-muted-foreground";

  switch (execution.targetKind) {
    case "cloud-sandbox":
      return (
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                aria-label={tooltip}
                className={cn(wrapperClassName, "ml-1")}
                tabIndex={0}
              >
                <Cloud className={iconClassName} strokeWidth={2.25} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4} className="text-xs">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case "local":
      return (
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                aria-label={tooltip}
                className={cn(wrapperClassName, "ml-1")}
                tabIndex={0}
              >
                <Monitor className={iconClassName} strokeWidth={2.25} />
                <span className="text-[11px] font-medium leading-none">
                  {t("tracking.toolCall.runCommand.localBadge")}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4} className="text-xs">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    case "ahand-device":
      return (
        <TooltipProvider delayDuration={0} skipDelayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                aria-label={tooltip}
                className={cn(wrapperClassName, "ml-1 text-muted-foreground")}
                tabIndex={0}
              >
                <Server className={iconClassName} strokeWidth={2.25} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={4} className="text-xs">
              {tooltip}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    default:
      return <span>{label}</span>;
  }
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
  previewSourceName,
  t,
  value,
}: {
  className: string;
  label: string;
  previewSourceName?: string;
  rawValue?: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  value: string;
}) {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const rawText = rawValue ?? value;
  const structuredJson = parseStructuredJson(rawText);
  const syntaxPreview = structuredJson
    ? undefined
    : getSyntaxPreview(rawText, previewSourceName);
  const hasPreview = !!structuredJson || !!syntaxPreview;

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
                {hasPreview && (
                  <div className="flex overflow-hidden rounded border border-border bg-muted/40 p-0.5">
                    <button
                      type="button"
                      aria-pressed={!showRaw}
                      className={cn(
                        "rounded-sm px-2 py-1 text-[11px] leading-none text-muted-foreground hover:text-foreground",
                        !showRaw && "bg-background text-foreground shadow-sm",
                      )}
                      onClick={() => setShowRaw(false)}
                    >
                      {structuredJson ? "tree" : "preview"}
                    </button>
                    <button
                      type="button"
                      aria-pressed={showRaw}
                      className={cn(
                        "rounded-sm px-2 py-1 text-[11px] leading-none text-muted-foreground hover:text-foreground",
                        showRaw && "bg-background text-foreground shadow-sm",
                      )}
                      onClick={() => setShowRaw(true)}
                    >
                      {t("tracking.toolCall.rawJson")}
                    </button>
                  </div>
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
            {structuredJson && !showRaw ? (
              <JsonTreeView data={structuredJson} />
            ) : syntaxPreview && !showRaw ? (
              <SyntaxPreview
                className={className}
                language={syntaxPreview.language}
                text={syntaxPreview.text}
              />
            ) : (
              <pre
                className={cn(
                  className,
                  "m-0 min-h-0 flex-1 overflow-auto rounded-none border-0 !max-h-none",
                )}
              >
                {rawText}
              </pre>
            )}
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
  label: string;
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
  resultImages,
  resultText,
  isError,
  t,
}: {
  argsText: string;
  resultImages: ToolResultImage[];
  resultText: string;
  isError: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const argsLabel = t("tracking.toolCall.argsLabel");
  const resultLabel = t("tracking.toolCall.resultLabel");
  const resultPreviewSourceName = extractPreviewSourceName(argsText);

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
      {(resultText !== "" || resultImages.length > 0) && (
        <div>
          <span
            className={cn(
              "text-xs font-semibold",
              isError ? "text-red-500" : "text-emerald-500",
            )}
          >
            {resultLabel}
          </span>
          {resultImages.length > 0 && (
            <div className="mt-1 grid gap-2">
              {resultImages.map((image) => (
                <img
                  key={image.alt}
                  alt={image.alt}
                  src={image.src}
                  className={cn(
                    "max-h-96 w-fit max-w-full rounded-md border border-border bg-muted/30 object-contain",
                    "shadow-sm",
                  )}
                />
              ))}
            </div>
          )}
          {resultText !== "" && (
            <ExpandablePre
              className={cn(
                "mt-0.5 p-2 rounded-md text-xs leading-relaxed max-h-44 overflow-y-auto whitespace-pre-wrap break-all font-mono",
                isError
                  ? "bg-red-500/5 border border-red-500/20 text-red-700 dark:text-red-300"
                  : "bg-muted/60 border border-border text-foreground/85",
                resultImages.length > 0 && "mt-2",
              )}
              label={resultLabel}
              previewSourceName={resultPreviewSourceName}
              rawValue={resultText}
              t={t}
              value={formatJson(resultText)}
            />
          )}
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
  const resultImages = displayState.resultImages;
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
  const commandMessage = commandExecution?.message;
  const hasCommandMessage = !!commandMessage?.trim();
  const commandExitCode = commandExecution?.exitCode;
  const shouldShowCommandExitCode =
    commandExitCode !== undefined &&
    ((!hasCommandStdout && !hasCommandStderr) || commandExitCode !== "0");
  const isStreamingArgs =
    callMetadata.toolPhase === "args_streaming" &&
    displayState.argsText.trim() !== "";
  const showDetails = isExpanded || isStreamingArgs;
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
            <RunCommandSummary
              execution={commandExecution}
              isError={isError}
              isRunning={isRunning}
              t={translate}
            />
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
        {isRunCommandDisplay && isExpanded && (
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
            showDetails && "rotate-90",
          )}
        />
      </div>

      {isTodoWriteDisplay && (
        <TodoWriteStatusList todo={todoWrite} t={translate} />
      )}

      {/* Expanded: full args + result (including error detail on failure) */}
      {showDetails && (
        <div className="mt-1 mb-1.5 space-y-2">
          {isRunCommandDisplay && !showRawJson ? (
            <>
              {commandExecution.backend && (
                <StreamBlock
                  label="backend"
                  value={commandExecution.backend}
                  tone="neutral"
                  emptyText={translate("tracking.toolCall.emptyStream")}
                  t={translate}
                />
              )}
              <StreamBlock
                label="command"
                value={commandExecution.command}
                tone="neutral"
                emptyText={translate("tracking.toolCall.emptyStream")}
                t={translate}
              />
              {hasCommandMessage && (
                <StreamBlock
                  label="message"
                  value={commandMessage ?? ""}
                  tone="neutral"
                  emptyText={translate("tracking.toolCall.emptyStream")}
                  t={translate}
                />
              )}
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
              resultImages={resultImages}
              isError={isError}
              t={translate}
            />
          )}
        </div>
      )}
    </div>
  );
}
