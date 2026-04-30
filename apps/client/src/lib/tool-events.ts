import { formatParams } from "@/config/toolParamConfig";
import type { StatusType } from "@/config/toolLabels";
import type { AgentEventMetadata } from "@/types/im";

export type ToolIndicator = "check" | "cross" | "none";

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
  errorMessage?: string;
}

interface BuildToolDisplayStateInput {
  callMetadata: AgentEventMetadata;
  resultMetadata?: AgentEventMetadata;
  resultContent?: string;
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

function formatArgs(toolName: string, metadata: AgentEventMetadata): string {
  if (metadata.toolArgs) return formatParams(toolName, metadata.toolArgs);
  return metadata.toolArgsText ?? "";
}

export function buildToolDisplayState({
  callMetadata,
  resultMetadata,
  resultContent = "",
}: BuildToolDisplayStateInput): ToolDisplayState {
  const toolName =
    callMetadata.toolName ?? resultMetadata?.toolName ?? "Unknown tool";
  const resultText = unwrapToolResultContent(resultContent);
  const explicitFailure =
    resultMetadata?.success === false ||
    resultMetadata?.status === "failed" ||
    resultMetadata?.status === "cancelled" ||
    resultMetadata?.status === "timeout";
  const legacyFailure = resultText
    ? detectLegacyFailure(resultText)
    : undefined;
  const errorMessage =
    resultMetadata?.errorMessage ?? legacyFailure ?? undefined;

  const status: StatusType =
    !resultMetadata || resultMetadata.status === "running"
      ? "loading"
      : explicitFailure || legacyFailure
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
    argsSummary: formatArgs(toolName, callMetadata),
    argsText:
      callMetadata.toolArgsText ??
      (callMetadata.toolArgs
        ? JSON.stringify(callMetadata.toolArgs, null, 2)
        : ""),
    resultText,
    ...(errorMessage ? { errorMessage } : {}),
  };
}
