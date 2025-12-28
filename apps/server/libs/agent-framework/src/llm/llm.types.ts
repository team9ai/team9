/**
 * LLM types for agent-runtime memory system
 * These are abstractions over the ai-client interfaces
 */

/**
 * Message for LLM completion
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Tool call ID (for tool role messages) */
  toolCallId?: string;
}

/**
 * Tool definition for LLM
 */
export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Tool call from LLM response
 */
export interface LLMToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Request for LLM completion
 */
export interface LLMCompletionRequest {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Available tools for the LLM to call */
  tools?: LLMToolDefinition[];
  /**
   * Abort signal for cancelling the request
   * When aborted, the LLM adapter should cancel the underlying API call
   * and throw an AbortError or similar error
   */
  signal?: AbortSignal;
}

/**
 * Response from LLM completion
 */
export interface LLMCompletionResponse {
  /** Text content (may be empty if tool calls are present) */
  content: string;
  /** Tool calls requested by the LLM */
  toolCalls?: LLMToolCall[];
  /** Stop reason */
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'content_filter';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * LLM adapter interface for memory system
 * This is injected into MemoryManager and used by compactors
 */
export interface ILLMAdapter {
  /**
   * Complete a chat request
   * @param request - The completion request
   * @returns The completion response
   */
  complete(request: LLMCompletionRequest): Promise<LLMCompletionResponse>;
}

/**
 * Configuration for LLM operations in memory system
 */
export interface LLMConfig {
  /** The model to use */
  model: string;
  /** Temperature (default: 0.7) */
  temperature?: number;
  /** Max tokens for output */
  maxTokens?: number;
  /** Top P sampling */
  topP?: number;
  /** Frequency penalty */
  frequencyPenalty?: number;
  /** Presence penalty */
  presencePenalty?: number;
}
