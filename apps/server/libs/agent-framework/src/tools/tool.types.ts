/**
 * Tool type definitions for Agent Framework
 */

/**
 * JSON Schema for tool parameters
 */
export interface ToolParameterSchema {
  type: 'object';
  properties: Record<
    string,
    {
      type: string;
      description?: string;
      enum?: string[];
      items?: { type: string };
    }
  >;
  required?: string[];
}

/**
 * Tool definition that can be provided to LLM
 */
export interface ToolDefinition {
  /** Unique tool name */
  name: string;
  /** Human-readable description for LLM */
  description: string;
  /** JSON Schema for parameters */
  parameters: ToolParameterSchema;
  /**
   * Whether this tool causes the agent to wait for external response
   * - true: Agent stops execution after calling this tool (e.g., ask_user, output)
   * - false: Tool executes immediately and agent continues (e.g., read_file)
   */
  awaitsExternalResponse: boolean;
}

/**
 * Tool call from LLM
 */
export interface ToolCall {
  /** Tool name */
  name: string;
  /** Call ID for matching result */
  callId: string;
  /** Tool arguments */
  arguments: Record<string, unknown>;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  /** Call ID to match with tool call */
  callId: string;
  /** Whether execution succeeded */
  success: boolean;
  /** Result content (string or structured) */
  content: unknown;
  /** Error message if failed */
  error?: string;
}

/**
 * Tool executor function
 */
export type ToolExecutor = (
  args: Record<string, unknown>,
  context: ToolExecutionContext,
) => Promise<ToolResult>;

/**
 * Context provided to tool executors
 */
export interface ToolExecutionContext {
  /** Current thread ID */
  threadId: string;
  /** Agent ID */
  agentId?: string;
  /** Call ID for this execution */
  callId: string;
}
