import { formatParams } from "@/config/toolParamConfig";
import type { StatusType } from "@/config/toolLabels";
import type { AgentEventMetadata } from "@/types/im";

export type ToolIndicator = "check" | "cross" | "none";
export type CommandTargetKind =
  | "local"
  | "cloud-computer"
  | "cloud-sandbox"
  | "backend";

export interface CommandExecutionDisplay {
  command: string;
  backend?: string;
  targetKind: CommandTargetKind;
  targetName?: string;
  stdout: string;
  stderr: string;
  exitCode?: string;
}

export interface TodoWriteDisplay {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  items: TodoWriteItemDisplay[];
}

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoWriteItemDisplay {
  content: string;
  activeForm?: string;
  status: TodoStatus;
}

export interface ToolDisplayState {
  toolName: string;
  status: StatusType;
  isRunning: boolean;
  isError: boolean;
  isSuccess: boolean;
  indicator: ToolIndicator;
  argsSummary: string;
  argsText: string;
  resultText: string;
  commandExecution?: CommandExecutionDisplay;
  loadedToolNames?: string[];
  todoWrite?: TodoWriteDisplay;
  errorMessage?: string;
}

interface BuildToolDisplayStateInput {
  callMetadata: AgentEventMetadata;
  resultMetadata?: AgentEventMetadata;
  resultContent?: string;
}

interface ResolvedToolCall {
  toolName: string;
  toolArgs?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function textFromValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function unwrapToolResultContent(raw = ""): string {
  const parsed = tryParseJson(raw);
  if (isRecord(parsed) && Array.isArray(parsed.content)) {
    const texts = parsed.content
      .filter((block): block is { type: string; text: string } => {
        return (
          isRecord(block) &&
          block.type === "text" &&
          typeof block.text === "string"
        );
      })
      .map((block) => block.text);
    if (texts.length > 0) return texts.join("\n");
  }
  return raw;
}

function findFailure(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (payload.success === false) {
    if (typeof payload.errorMessage === "string") return payload.errorMessage;
    if (typeof payload.error === "string") return payload.error;
    return "Tool returned success=false";
  }
  if (typeof payload.errorMessage === "string") return payload.errorMessage;
  if (typeof payload.error === "string") return payload.error;
  return undefined;
}

function detectLegacyFailure(resultText: string): string | undefined {
  const parsed = tryParseJson(resultText);
  return findFailure(parsed);
}

function detectToolRuntimeFailure(resultText: string): string | undefined {
  const trimmed = resultText.trim();
  if (/^tool not found:/i.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

function canInferLegacyFailure(
  metadata: AgentEventMetadata | undefined,
): boolean {
  return !(
    metadata?.success === true &&
    (metadata.status === "completed" || metadata.status === "resolved")
  );
}

function resolveToolCall(
  callMetadata: AgentEventMetadata,
  resultMetadata?: AgentEventMetadata,
): ResolvedToolCall {
  const fallbackToolName =
    callMetadata.toolName ?? resultMetadata?.toolName ?? "Unknown tool";

  if (
    callMetadata.toolName === "invoke_tool" &&
    isRecord(callMetadata.toolArgs)
  ) {
    const nestedToolName = callMetadata.toolArgs.name;
    if (typeof nestedToolName === "string" && nestedToolName.trim()) {
      const nestedParams = callMetadata.toolArgs.params;
      return {
        toolName: nestedToolName,
        ...(isRecord(nestedParams) ? { toolArgs: nestedParams } : {}),
      };
    }
  }

  return {
    toolName: fallbackToolName,
    ...(callMetadata.toolArgs ? { toolArgs: callMetadata.toolArgs } : {}),
  };
}

export function getDisplayToolName(
  metadata: AgentEventMetadata,
  fallbackMetadata?: AgentEventMetadata,
): string {
  return resolveToolCall(metadata, fallbackMetadata).toolName;
}

function extractE2bName(backend: string): string {
  const e2bId = backend.match(/e2b[_:-][A-Za-z0-9_-]+/i)?.[0];
  if (e2bId) return e2bId;
  const parts = backend.split(":").filter(Boolean);
  return parts[parts.length - 1] || backend;
}

function resolveCommandTarget(
  backend?: string,
): Pick<CommandExecutionDisplay, "targetKind" | "targetName"> {
  if (!backend) return { targetKind: "backend" };

  const normalized = backend.toLowerCase();
  if (normalized.includes("user-computer")) {
    return { targetKind: "local" };
  }
  if (normalized.includes("just-bash")) {
    return { targetKind: "cloud-sandbox", targetName: "just-bash" };
  }
  if (normalized.includes("e2b")) {
    return {
      targetKind: "cloud-computer",
      targetName: extractE2bName(backend),
    };
  }
  return { targetKind: "backend", targetName: backend };
}

function buildCommandExecution(
  toolName: string,
  toolArgs: Record<string, unknown> | undefined,
  resultText: string,
): CommandExecutionDisplay | undefined {
  if (toolName !== "run_command" || !toolArgs) return undefined;

  const command =
    textFromValue(toolArgs.command) ||
    textFromValue(toolArgs.cmd) ||
    textFromValue(toolArgs.name);
  if (!command) return undefined;

  const backend = textFromValue(toolArgs.backend) || undefined;
  const parsedResult = tryParseJson(resultText);
  const resultRecord = isRecord(parsedResult) ? parsedResult : undefined;
  const stdout = resultRecord
    ? textFromValue(resultRecord.stdout)
    : resultText.trim()
      ? resultText
      : "";
  const stderr = resultRecord ? textFromValue(resultRecord.stderr) : "";
  const exitCode =
    resultRecord &&
    (typeof resultRecord.exitCode === "number" ||
      typeof resultRecord.exitCode === "string")
      ? String(resultRecord.exitCode)
      : undefined;

  return {
    command,
    ...(backend ? { backend } : {}),
    ...resolveCommandTarget(backend),
    stdout,
    stderr,
    ...(exitCode !== undefined ? { exitCode } : {}),
  };
}

function buildLoadedToolNames(
  toolName: string,
  toolArgs: Record<string, unknown> | undefined,
): string[] | undefined {
  if (toolName !== "load_tools" || !toolArgs) return undefined;
  const names = toolArgs.names;
  if (!Array.isArray(names)) return undefined;

  const toolNames = names.filter(
    (name): name is string => typeof name === "string" && name.trim() !== "",
  );
  return toolNames.length > 0 ? toolNames : undefined;
}

function isTodoWriteTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return normalized === "todowrite" || normalized === "todo_write";
}

function isTodoStatus(value: unknown): value is TodoStatus {
  return (
    value === "pending" || value === "in_progress" || value === "completed"
  );
}

function buildTodoWriteDisplay(
  toolName: string,
  toolArgs: Record<string, unknown> | undefined,
): TodoWriteDisplay | undefined {
  if (!isTodoWriteTool(toolName) || !toolArgs) return undefined;
  const todos = toolArgs.todos;
  if (!Array.isArray(todos)) return undefined;

  const display: TodoWriteDisplay = {
    total: 0,
    pending: 0,
    inProgress: 0,
    completed: 0,
    items: [],
  };

  for (const todo of todos) {
    if (!isRecord(todo)) continue;

    const { status } = todo;
    if (!isTodoStatus(status) || typeof todo.content !== "string") continue;

    display.total += 1;
    if (status === "pending") display.pending += 1;
    if (status === "in_progress") display.inProgress += 1;
    if (status === "completed") display.completed += 1;

    const activeForm =
      typeof todo.activeForm === "string" && todo.activeForm.trim()
        ? todo.activeForm
        : undefined;
    display.items.push({
      content: todo.content,
      ...(activeForm ? { activeForm } : {}),
      status,
    });
  }

  return display.total > 0 ? display : undefined;
}

function formatArgs(
  toolName: string,
  metadata: AgentEventMetadata,
  toolArgs?: Record<string, unknown>,
): string {
  if (metadata.toolPhase === "args_streaming" && metadata.toolArgsText) {
    return metadata.toolArgsText;
  }
  if (toolArgs) return formatParams(toolName, toolArgs);
  return metadata.toolArgsText ?? "";
}

function formatArgsText(
  metadata: AgentEventMetadata,
  toolArgs?: Record<string, unknown>,
): string {
  if (metadata.toolPhase === "args_streaming" && metadata.toolArgsText) {
    return metadata.toolArgsText;
  }
  return toolArgs
    ? JSON.stringify(toolArgs, null, 2)
    : (metadata.toolArgsText ?? "");
}

export function buildToolDisplayState({
  callMetadata,
  resultMetadata,
  resultContent = "",
}: BuildToolDisplayStateInput): ToolDisplayState {
  const resolvedToolCall = resolveToolCall(callMetadata, resultMetadata);
  const toolName = resolvedToolCall.toolName;
  const resultText = unwrapToolResultContent(resultContent);
  const explicitFailure =
    resultMetadata?.success === false ||
    resultMetadata?.status === "failed" ||
    resultMetadata?.status === "cancelled" ||
    resultMetadata?.status === "timeout";
  const runtimeFailure = resultText
    ? detectToolRuntimeFailure(resultText)
    : undefined;
  const legacyFailure =
    resultText && canInferLegacyFailure(resultMetadata)
      ? detectLegacyFailure(resultText)
      : undefined;
  const errorMessage =
    resultMetadata?.errorMessage ??
    runtimeFailure ??
    legacyFailure ??
    undefined;

  const status: StatusType =
    !resultMetadata || resultMetadata.status === "running"
      ? "loading"
      : explicitFailure || runtimeFailure || legacyFailure
        ? "error"
        : "success";

  return {
    toolName,
    status,
    isRunning: status === "loading",
    isError: status === "error",
    isSuccess: status === "success",
    indicator:
      status === "success" ? "check" : status === "error" ? "cross" : "none",
    argsSummary: formatArgs(toolName, callMetadata, resolvedToolCall.toolArgs),
    argsText: formatArgsText(callMetadata, resolvedToolCall.toolArgs),
    resultText,
    commandExecution: buildCommandExecution(
      toolName,
      resolvedToolCall.toolArgs,
      resultText,
    ),
    loadedToolNames: buildLoadedToolNames(toolName, resolvedToolCall.toolArgs),
    todoWrite: buildTodoWriteDisplay(toolName, resolvedToolCall.toolArgs),
    ...(errorMessage ? { errorMessage } : {}),
  };
}
