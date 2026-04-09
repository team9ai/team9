/**
 * Tool Labels Configuration
 *
 * Provides a three-tier fallback system for getting display labels for agent tool operations:
 * 1. Tool-specific labels (highest priority)
 * 2. Operation-type labels (medium priority)
 * 3. Formatted fallback (lowest priority)
 */

/**
 * Labels for operation types
 * Used as the secondary fallback when a specific tool doesn't have a custom label
 */
export const operationLabels: Record<string, string> = {
  load_tools: "正在加载工具",
  search_tools: "正在搜索工具",
  invoke_tool: "正在调用工具",
};

/**
 * Labels for specific tool names
 * Used as the primary label source - takes precedence over operation types
 */
export const toolNameLabels: Record<string, string> = {
  search_docs: "正在搜索文档",
  send_message: "正在发送消息",
  generate_reply: "正在生成回复",
};

/**
 * Get a display label for a tool operation
 *
 * Priority:
 * 1. Tool-specific label from toolNameLabels (highest)
 * 2. Operation-type label from operationLabels (medium)
 * 3. Formatted fallback: "正在{operationType}" (lowest)
 *
 * @param operationType - The type of operation (e.g., 'load_tools', 'invoke_tool')
 * @param toolName - The name of the tool being operated on (optional)
 * @param status - The status of the operation (optional, for future use)
 * @returns A user-friendly label describing the operation
 */
export function getLabel(
  operationType?: string,
  toolName?: string,
  _status?: string,
): string {
  // Priority 1: Tool-specific label
  if (
    toolName &&
    typeof toolName === "string" &&
    toolName.trim() &&
    toolName in toolNameLabels
  ) {
    return toolNameLabels[toolName];
  }

  // Priority 2: Operation-type label
  if (
    operationType &&
    typeof operationType === "string" &&
    operationType in operationLabels
  ) {
    return operationLabels[operationType];
  }

  // Priority 3: Formatted fallback
  const opType = operationType || "unknown";
  return `正在${opType}`;
}
