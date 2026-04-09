/**
 * Tool Labels Configuration
 *
 * Provides a three-tier fallback system for resolving i18n keys that describe
 * agent tool operations:
 * 1. Tool-specific keys (highest priority, matched by `toolName`)
 * 2. Operation-type keys (medium priority, matched by `operationType`)
 * 3. Generic fallback key with an interpolated `{{name}}` variable (lowest)
 *
 * The i18n keys returned here live under the `channel` namespace (see
 * `apps/client/src/i18n/locales/{en,zh}/channel.json`) at `tracking.ops.*`
 * and `tracking.tools.*`. Each status (`loading` / `success` / `error`)
 * has its own sub-key so callers can translate based on runtime state.
 */

export type StatusType = "loading" | "success" | "error";

const VALID_STATUSES: readonly StatusType[] = [
  "loading",
  "success",
  "error",
] as const;

/**
 * Map operation types to their i18n base key (without the status suffix).
 * Used as the secondary fallback when a specific tool doesn't have a
 * dedicated key.
 */
export const operationLabelKeys: Record<string, string> = {
  load_tools: "tracking.ops.loadTools",
  search_tools: "tracking.ops.searchTools",
  invoke_tool: "tracking.ops.invokeTool",
};

/**
 * Map known tool names to their i18n base key (without the status suffix).
 * Takes precedence over `operationLabelKeys` so per-tool copy like "Sending
 * message" overrides the generic "Calling tool" wording.
 */
export const toolNameLabelKeys: Record<string, string> = {
  search_docs: "tracking.tools.searchDocs",
  send_message: "tracking.tools.sendMessage",
  generate_reply: "tracking.tools.generateReply",
};

/** Generic fallback key used when neither the tool name nor the operation
 * type is recognized. The corresponding entry in channel.json uses a
 * `{{name}}` interpolation so the caller can surface the raw identifier. */
export const FALLBACK_KEY_BASE = "tracking.ops.fallback";

export interface LabelKeyDescriptor {
  /** Fully-resolved i18n key including the status suffix. */
  key: string;
  /** Interpolation values to pass to `t(key, values)`. Only populated for
   * the fallback path, which needs the raw tool / operation name. */
  values?: Record<string, string>;
}

/**
 * Get the i18n key descriptor for a tool operation.
 *
 * Priority:
 * 1. Tool-specific key from `toolNameLabelKeys` (highest)
 * 2. Operation-type key from `operationLabelKeys` (medium)
 * 3. Generic fallback key with `name` interpolation (lowest)
 *
 * Invalid / missing `status` values are normalised to `"loading"` so callers
 * can always pass them through to `t()` without crashing on unexpected
 * runtime data.
 *
 * @param operationType - The type of operation (e.g., 'load_tools', 'invoke_tool')
 * @param toolName - The name of the tool being operated on (optional)
 * @param status - The status of the operation ('loading', 'success', 'error'), defaults to 'loading'
 * @returns An object containing the i18n key to translate and any values to interpolate
 */
export function getLabelKey(
  operationType?: string,
  toolName?: string,
  status: StatusType = "loading",
): LabelKeyDescriptor {
  // Validate and sanitize status - default to 'loading' if null/invalid
  const safeStatus: StatusType = VALID_STATUSES.includes(status as StatusType)
    ? (status as StatusType)
    : "loading";

  // Priority 1: Tool-specific label
  if (
    toolName &&
    typeof toolName === "string" &&
    toolName.trim() &&
    toolName in toolNameLabelKeys
  ) {
    return {
      key: `${toolNameLabelKeys[toolName]}.${safeStatus}`,
    };
  }

  // Priority 2: Operation-type label
  if (
    operationType &&
    typeof operationType === "string" &&
    operationType in operationLabelKeys
  ) {
    return {
      key: `${operationLabelKeys[operationType]}.${safeStatus}`,
    };
  }

  // Priority 3: Formatted fallback with {{name}} interpolation.
  const opType = operationType || "unknown";
  const nameValue =
    toolName && typeof toolName === "string" && toolName.trim()
      ? toolName
      : opType;
  return {
    key: `${FALLBACK_KEY_BASE}.${safeStatus}`,
    values: { name: nameValue },
  };
}
