/**
 * LLM types for agent-runtime memory system
 * These are abstractions over the ai-client interfaces
 */

/**
 * Message for LLM completion
 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Request for LLM completion
 */
export interface LLMCompletionRequest {
  messages: LLMMessage[];
  temperature?: number;
  maxTokens?: number;
}

/**
 * Response from LLM completion
 */
export interface LLMCompletionResponse {
  content: string;
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
  /** The model to use for compaction */
  compactModel: string;
  /** Temperature for compaction (default: 0.3) */
  compactTemperature?: number;
  /** Max tokens for compaction output */
  compactMaxTokens?: number;
}
