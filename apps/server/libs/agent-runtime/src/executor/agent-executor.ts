import type {
  MemoryManager,
  MemoryState,
  ILLMAdapter,
  LLMMessage,
  AgentEvent,
  DispatchResult,
  ContextBuilder,
  MemoryChunk,
} from '@team9/agent-framework';

/**
 * Agent Executor Configuration
 */
export interface AgentExecutorConfig {
  /** Maximum number of LLM turns before stopping */
  maxTurns?: number;
  /** Timeout in milliseconds for each LLM call */
  timeout?: number;
  /** Whether to auto-run after inject */
  autoRun?: boolean;
}

/**
 * Execution result from running the agent loop
 */
export interface ExecutionResult {
  /** Whether execution completed successfully */
  success: boolean;
  /** Final state after execution */
  finalState: MemoryState;
  /** Number of LLM turns executed */
  turnsExecuted: number;
  /** Last LLM response content */
  lastResponse?: string;
  /** Error if execution failed */
  error?: string;
  /** All events generated during execution */
  events: AgentEvent[];
}

/**
 * AgentExecutor handles the LLM response generation loop
 *
 * Flow:
 * 1. User message is injected into Memory
 * 2. Executor builds context from Memory state
 * 3. Calls LLM to generate a response
 * 4. Dispatches LLM response as event to Memory
 * 5. (Future) If LLM calls tools, execute tools and loop back to step 2
 */
export class AgentExecutor {
  private config: Required<AgentExecutorConfig>;
  private contextBuilder: ContextBuilder;

  constructor(
    private memoryManager: MemoryManager,
    private llmAdapter: ILLMAdapter,
    config: AgentExecutorConfig = {},
  ) {
    this.config = {
      maxTurns: config.maxTurns ?? 10,
      timeout: config.timeout ?? 60000,
      autoRun: config.autoRun ?? true,
    };

    // Create context builder
    const { createContextBuilder } =
      require('@team9/agent-framework') as typeof import('@team9/agent-framework');
    this.contextBuilder = createContextBuilder();
  }

  /**
   * Run the agent loop after an event is injected
   * Returns when the agent completes or reaches max turns
   */
  async run(threadId: string): Promise<ExecutionResult> {
    const events: AgentEvent[] = [];
    let turnsExecuted = 0;
    let lastResponse: string | undefined;

    try {
      while (turnsExecuted < this.config.maxTurns) {
        // Get current state
        const currentState = await this.memoryManager.getCurrentState(threadId);
        if (!currentState) {
          throw new Error(`Thread not found: ${threadId}`);
        }

        // Check if we need to generate a response
        // We should respond if the last chunk is from user/input
        const needsResponse = this.needsLLMResponse(currentState);
        if (!needsResponse) {
          // Agent has completed its response
          break;
        }

        // Build context for LLM
        const context = this.contextBuilder.build(currentState);
        const messages: LLMMessage[] = context.messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        }));

        // Call LLM
        const llmResponse = await this.callLLMWithTimeout(messages);
        lastResponse = llmResponse;

        // Parse LLM response to determine event type
        const responseEvent = this.parseResponseToEvent(llmResponse);
        events.push(responseEvent);

        // Dispatch the response event
        await this.memoryManager.dispatch(threadId, responseEvent);

        turnsExecuted++;

        // If it's a text response (not tool call), we're done
        if (responseEvent.type === 'LLM_TEXT_RESPONSE') {
          break;
        }

        // TODO: Handle tool calls - for now, just break
        break;
      }

      const finalState = await this.memoryManager.getCurrentState(threadId);
      if (!finalState) {
        throw new Error(`Thread not found: ${threadId}`);
      }

      return {
        success: true,
        finalState,
        turnsExecuted,
        lastResponse,
        events,
      };
    } catch (error) {
      const finalState = await this.memoryManager.getCurrentState(threadId);
      return {
        success: false,
        finalState: finalState!,
        turnsExecuted,
        lastResponse,
        error: error instanceof Error ? error.message : String(error),
        events,
      };
    }
  }

  /**
   * Check if LLM needs to respond based on current state
   */
  private needsLLMResponse(state: MemoryState): boolean {
    // Get the last chunk
    const chunkIds = state.chunkIds;
    if (chunkIds.length === 0) return false;

    const lastChunkId = chunkIds[chunkIds.length - 1];
    const lastChunk = state.chunks.get(lastChunkId);
    if (!lastChunk) return false;

    // Check chunk type - need response if it's user input or tool result
    const { ChunkType, WorkingFlowSubType } =
      require('@team9/agent-framework') as typeof import('@team9/agent-framework');

    // WORKING_FLOW chunks - check subType
    if (lastChunk.type === ChunkType.WORKING_FLOW) {
      const subType = lastChunk.subType;
      // USER subType needs LLM response
      if (subType === WorkingFlowSubType.USER) {
        return true;
      }
      // ACTION_RESPONSE (tool results) needs LLM response
      if (subType === WorkingFlowSubType.ACTION_RESPONSE) {
        return true;
      }
    }

    // DELEGATION chunks from parent agent need response
    if (lastChunk.type === ChunkType.DELEGATION) {
      return true;
    }

    return false;
  }

  /**
   * Call LLM with timeout
   */
  private async callLLMWithTimeout(messages: LLMMessage[]): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await this.llmAdapter.complete({ messages });
      return response.content;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse LLM response to determine the appropriate event type
   * For now, we treat all responses as text responses
   * TODO: Parse for tool calls, clarifications, etc.
   */
  private parseResponseToEvent(response: string): AgentEvent {
    const { EventType } =
      require('@team9/agent-framework') as typeof import('@team9/agent-framework');

    // TODO: Parse response for tool calls, etc.
    // For now, treat everything as text response
    return {
      type: EventType.LLM_TEXT_RESPONSE,
      content: response,
      timestamp: Date.now(),
    };
  }
}

/**
 * Create an agent executor
 */
export function createAgentExecutor(
  memoryManager: MemoryManager,
  llmAdapter: ILLMAdapter,
  config?: AgentExecutorConfig,
): AgentExecutor {
  return new AgentExecutor(memoryManager, llmAdapter, config);
}
