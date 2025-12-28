import type {
  MemoryManager,
  MemoryState,
  ILLMAdapter,
  LLMMessage,
  AgentEvent,
  ContextBuilder,
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
   * Run agent loop until it needs to wait for external response or reaches max turns
   *
   * Continues running when:
   * - LLM_TEXT_RESPONSE: just output, can continue
   * - After receiving TOOL_RESULT/SKILL_RESULT/SUBAGENT_RESULT
   *
   * Stops running when:
   * - LLM_TOOL_CALL: wait for tool execution
   * - LLM_SKILL_CALL: wait for skill execution
   * - LLM_SUBAGENT_SPAWN: wait for subagent
   * - LLM_CLARIFICATION: wait for user clarification
   * - TASK_COMPLETED/TASK_ABANDONED/TASK_TERMINATED: task ended
   * - Max turns reached
   */
  async run(threadId: string): Promise<ExecutionResult> {
    const events: AgentEvent[] = [];
    let turnsExecuted = 0;
    let lastResponse: string | undefined;

    const { EventType } =
      require('@team9/agent-framework') as typeof import('@team9/agent-framework');

    try {
      while (turnsExecuted < this.config.maxTurns) {
        const currentState = await this.memoryManager.getCurrentState(threadId);
        if (!currentState) {
          throw new Error(`Thread not found: ${threadId}`);
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

        // Check if we should stop - waiting for external response
        if (this.shouldWaitForExternalResponse(responseEvent.type)) {
          break;
        }

        // LLM_TEXT_RESPONSE without tool calls - agent is done for now
        // (In a real implementation, we'd check if the response contains more actions)
        if (responseEvent.type === EventType.LLM_TEXT_RESPONSE) {
          break;
        }
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
   * Check if the event type requires waiting for external response
   */
  private shouldWaitForExternalResponse(eventType: string): boolean {
    const { EventType } =
      require('@team9/agent-framework') as typeof import('@team9/agent-framework');

    switch (eventType) {
      // Tool/Skill/SubAgent calls - wait for execution result
      case EventType.LLM_TOOL_CALL:
      case EventType.LLM_SKILL_CALL:
      case EventType.LLM_SUBAGENT_SPAWN:
      case EventType.LLM_SUBAGENT_MESSAGE:
      case EventType.LLM_CLARIFICATION:
        return true;

      // Task ended
      case EventType.TASK_COMPLETED:
      case EventType.TASK_ABANDONED:
      case EventType.TASK_TERMINATED:
        return true;

      default:
        return false;
    }
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
