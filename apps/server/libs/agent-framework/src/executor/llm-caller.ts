/**
 * LLM Caller
 *
 * Handles LLM API calls with timeout and cancellation support.
 * Captures LLM interaction data for debugging.
 */

import type {
  ILLMAdapter,
  LLMMessage,
  LLMToolDefinition,
  LLMCompletionResponse,
} from '../llm/llm.types.js';
import type { LLMInteraction } from '../types/thread.types.js';
import type { CancellationTokenSource } from './executor.types.js';

/**
 * Result of an LLM call including interaction data for debugging
 */
export interface LLMCallResult {
  /** The LLM response */
  response: LLMCompletionResponse;
  /** Interaction data for debugging */
  interaction: LLMInteraction;
}

/**
 * Request parameters for LLM call
 */
export interface LLMCallRequest {
  /** Messages to send to the LLM */
  messages: LLMMessage[];
  /** Tool definitions available for this request */
  toolDefinitions?: LLMToolDefinition[];
}

/**
 * Options for LLM call
 */
export interface LLMCallOptions {
  /** Cancellation token for aborting the request */
  cancellation?: CancellationTokenSource | null;
}

/**
 * LLMCaller handles LLM API calls with timeout and cancellation support
 */
export class LLMCaller {
  constructor(
    private llmAdapter: ILLMAdapter,
    private timeout: number,
  ) {}

  /**
   * Call LLM with timeout and cancellation support
   * Combines timeout abort with cancellation abort
   * Also captures the LLM interaction data for debugging
   */
  async callWithTimeout(
    request: LLMCallRequest,
    options: LLMCallOptions = {},
  ): Promise<LLMCallResult> {
    const { messages, toolDefinitions } = request;
    const { cancellation } = options;

    // Create timeout abort controller
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
      () => timeoutController.abort(new Error('LLM call timeout')),
      this.timeout,
    );

    // Combine timeout signal with cancellation signal
    // Use a combined controller since AbortSignal.any() may not be available
    const combinedController = new AbortController();
    const abortHandler = () => combinedController.abort();

    timeoutController.signal.addEventListener('abort', abortHandler);
    if (cancellation) {
      cancellation.signal.addEventListener('abort', abortHandler);
    }
    const combinedSignal = combinedController.signal;

    // Prepare tools for the request
    const tools =
      toolDefinitions && toolDefinitions.length > 0
        ? toolDefinitions
        : undefined;

    // Capture LLM interaction start
    const startedAt = Date.now();
    const interaction: LLMInteraction = {
      startedAt,
      request: {
        messages,
        tools,
      },
    };

    try {
      const response = await this.llmAdapter.complete({
        messages,
        tools,
        signal: combinedSignal,
      });

      // Capture LLM interaction completion
      const completedAt = Date.now();
      interaction.completedAt = completedAt;
      interaction.duration = completedAt - startedAt;
      interaction.response = {
        content: response.content,
        toolCalls: response.toolCalls,
        finishReason: response.finishReason as
          | 'stop'
          | 'tool_calls'
          | 'length'
          | 'content_filter'
          | undefined,
        usage: response.usage,
      };

      return { response, interaction };
    } catch (error) {
      // Capture error in LLM interaction
      const completedAt = Date.now();
      interaction.completedAt = completedAt;
      interaction.duration = completedAt - startedAt;
      interaction.error =
        error instanceof Error ? error.message : String(error);

      // Check if this was a cancellation (not timeout)
      if (cancellation?.isCancellationRequested) {
        throw new Error('LLM call cancelled');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      // Clean up event listeners
      timeoutController.signal.removeEventListener('abort', abortHandler);
      if (cancellation) {
        cancellation.signal.removeEventListener('abort', abortHandler);
      }
    }
  }
}

/**
 * Create an LLM caller instance
 */
export function createLLMCaller(
  llmAdapter: ILLMAdapter,
  timeout: number,
): LLMCaller {
  return new LLMCaller(llmAdapter, timeout);
}
