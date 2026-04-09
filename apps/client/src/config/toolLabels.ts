/**
 * Tool Labels Configuration
 *
 * Provides a three-tier fallback system for getting display labels for agent tool operations:
 * 1. Tool-specific labels (highest priority)
 * 2. Operation-type labels (medium priority)
 * 3. Formatted fallback (lowest priority)
 *
 * Each label includes three statuses: loading, success, error
 */

export type StatusType = "loading" | "success" | "error";

export interface StatusLabels {
  loading: string;
  success: string;
  error: string;
}

/**
 * Labels for operation types
 * Used as the secondary fallback when a specific tool doesn't have a custom label
 */
export const operationLabels: Record<string, StatusLabels> = {
  load_tools: {
    loading: "正在加载工具",
    success: "工具加载完成",
    error: "工具加载失败",
  },
  search_tools: {
    loading: "正在搜索工具",
    success: "工具搜索完成",
    error: "工具搜索失败",
  },
  invoke_tool: {
    loading: "正在调用工具",
    success: "工具调用完成",
    error: "工具调用失败",
  },
};

/**
 * Labels for specific tool names
 * Used as the primary label source - takes precedence over operation types
 */
export const toolNameLabels: Record<string, StatusLabels> = {
  search_docs: {
    loading: "正在搜索文档",
    success: "文档搜索完成",
    error: "文档搜索失败",
  },
  send_message: {
    loading: "正在发送消息",
    success: "消息发送完成",
    error: "消息发送失败",
  },
  generate_reply: {
    loading: "正在生成回复",
    success: "回复生成完成",
    error: "回复生成失败",
  },
};

/**
 * Get a display label for a tool operation
 *
 * Priority:
 * 1. Tool-specific label from toolNameLabels (highest)
 * 2. Operation-type label from operationLabels (medium)
 * 3. Formatted fallback (lowest)
 *
 * @param operationType - The type of operation (e.g., 'load_tools', 'invoke_tool')
 * @param toolName - The name of the tool being operated on (optional)
 * @param status - The status of the operation ('loading', 'success', 'error'), defaults to 'loading'
 * @returns A user-friendly label describing the operation
 */
export function getLabel(
  operationType?: string,
  toolName?: string,
  status: StatusType = "loading",
): string {
  // Validate and sanitize status - default to 'loading' if null/invalid
  const safeStatus: StatusType = (
    ["loading", "success", "error"] as const
  ).includes(status as StatusType)
    ? status
    : "loading";

  // Priority 1: Tool-specific label
  if (
    toolName &&
    typeof toolName === "string" &&
    toolName.trim() &&
    toolName in toolNameLabels
  ) {
    return toolNameLabels[toolName][safeStatus];
  }

  // Priority 2: Operation-type label
  if (
    operationType &&
    typeof operationType === "string" &&
    operationType in operationLabels
  ) {
    return operationLabels[operationType][safeStatus];
  }

  // Priority 3: Formatted fallback
  const opType = operationType || "unknown";
  const toolPart = toolName && toolName.trim() ? toolName : "工具";
  const actionMap: Record<StatusType, string> = {
    loading: "正在",
    success: "已完成",
    error: "失败",
  };
  return `${actionMap[safeStatus]}${opType} {${toolPart}}`;
}
