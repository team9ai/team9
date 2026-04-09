/**
 * Tool Parameter Configuration
 *
 * Provides parameter extraction and formatting configuration for different tools.
 * Supports key parameter selection and truncation rules for displaying agent step parameters.
 *
 * Each tool configuration specifies:
 * - keyParams: List of parameter names to extract and display
 * - truncate: Optional truncation limits for specific parameters
 */

/**
 * Configuration item for a tool's parameter handling
 */
export interface ToolParamConfigItem {
  /** List of parameter names to display/extract */
  keyParams: string[];
  /** Optional truncation limits per parameter (character limit) */
  truncate?: Record<string, number>;
}

/**
 * Parameter configuration for all supported tools
 * Maps tool names to their parameter configuration
 */
export const toolParamConfig: Record<string, ToolParamConfigItem> = {
  SendToChannel: {
    keyParams: ["channelName", "message"],
    truncate: {
      message: 50,
    },
  },
  SearchDocs: {
    keyParams: ["query", "limit"],
    truncate: {
      query: 80,
    },
  },
  InvokeAPI: {
    keyParams: ["endpoint", "query"],
    truncate: {
      query: 60,
    },
  },
};

/**
 * Convert a parameter value to string representation
 * Safely handles various data types
 */
function valueToString(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

/**
 * Truncate a string and add word count indicator
 * If string exceeds truncate limit, shows truncated value with "(N words more)"
 */
function truncateValue(value: string, limit: number): string {
  if (value.length <= limit) {
    return value;
  }

  const truncated = value.substring(0, limit);
  const moreWords = value.length - limit;
  return `${truncated}...(${moreWords} words more)`;
}

/**
 * Format parameters for a tool into a friendly display string
 *
 * @param toolName - Name of the tool (must match keys in toolParamConfig)
 * @param params - Object containing the tool's parameters
 * @returns Formatted string showing key parameters and values
 *
 * For configured tools: Extracts and displays only key parameters, with truncation applied
 * For unknown tools: Returns complete JSON representation of params
 *
 * @example
 * formatParams("SendToChannel", {
 *   channelName: "general",
 *   message: "Hello world",
 *   userId: "user123"
 * })
 * // Returns: "channelName: general, message: Hello world"
 *
 * @example
 * // With truncation
 * formatParams("SendToChannel", {
 *   channelName: "general",
 *   message: "a".repeat(100)
 * })
 * // Returns: "channelName: general, message: aaaa...aaaa(50 words more)"
 */
export function formatParams(
  toolName: string,
  params: Record<string, unknown>,
): string {
  // Handle null/undefined params
  if (!params || typeof params !== "object") {
    return JSON.stringify({});
  }

  // Check if tool is configured
  if (!toolName || !(toolName in toolParamConfig)) {
    // Fallback: return JSON for unknown tools
    return JSON.stringify(params);
  }

  const config = toolParamConfig[toolName];

  // Extract key parameters
  const formatted = config.keyParams
    .map((paramName) => {
      const value = params[paramName];
      let stringValue = valueToString(value);

      // Apply truncation if configured
      if (config.truncate && paramName in config.truncate) {
        const limit = config.truncate[paramName];
        stringValue = truncateValue(stringValue, limit);
      }

      return `${paramName}: ${stringValue}`;
    })
    .join(", ");

  return formatted;
}
