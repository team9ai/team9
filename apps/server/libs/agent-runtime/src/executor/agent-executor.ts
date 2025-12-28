import type {
  MemoryManager,
  MemoryState,
  ILLMAdapter,
  LLMMessage,
  LLMToolDefinition,
  LLMCompletionResponse,
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
  /** Available tool names for this agent */
  tools?: string[];
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
 * Internal config type with resolved defaults
 */
interface ResolvedConfig {
  maxTurns: number;
  timeout: number;
  autoRun: boolean;
  tools: string[];
}

/**
 * AgentExecutor handles the LLM response generation loop
 *
 * Flow:
 * 1. User message is injected into Memory
 * 2. Executor builds context from Memory state
 * 3. Calls LLM to generate a response (with tools)
 * 4. If LLM calls a tool, dispatch tool call event and stop
 * 5. If LLM returns text only, dispatch text response and continue loop
 * 6. Loop stops when: tool call, max turns reached, or task ended
 */
export class AgentExecutor {
  private config: ResolvedConfig;
  private contextBuilder: ContextBuilder;
  private toolDefinitions: LLMToolDefinition[];

  constructor(
    private memoryManager: MemoryManager,
    private llmAdapter: ILLMAdapter,
    config: AgentExecutorConfig = {},
  ) {
    this.config = {
      maxTurns: config.maxTurns ?? 10,
      timeout: config.timeout ?? 60000,
      autoRun: config.autoRun ?? true,
      tools: config.tools ?? [],
    };

    // Create context builder
    const { createContextBuilder, getToolsByNames } =
      require('@team9/agent-framework') as typeof import('@team9/agent-framework');
    this.contextBuilder = createContextBuilder();

    // Get tool definitions for LLM
    const tools = getToolsByNames(this.config.tools);
    this.toolDefinitions = tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    console.log('[AgentExecutor] Initialized with tools:', this.config.tools);
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

    try {
      console.log(
        '[AgentExecutor.run] Starting execution loop, maxTurns:',
        this.config.maxTurns,
      );

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

        console.log(
          '[AgentExecutor.run] Calling LLM with',
          messages.length,
          'messages and',
          this.toolDefinitions.length,
          'tools',
        );

        // Call LLM with tools
        const llmResponse = await this.callLLMWithTimeout(messages);
        console.log('[AgentExecutor.run] LLM response received:', {
          content: llmResponse.content?.substring(0, 100),
          toolCalls: llmResponse.toolCalls?.length ?? 0,
          finishReason: llmResponse.finishReason,
        });
        lastResponse = llmResponse.content;

        // Parse LLM response to determine event type
        const responseEvent = this.parseResponseToEvent(llmResponse);
        events.push(responseEvent);

        // Dispatch the response event
        console.log(
          '[AgentExecutor.run] Dispatching response event:',
          responseEvent.type,
        );
        const dispatchResult = await this.memoryManager.dispatch(
          threadId,
          responseEvent,
        );
        console.log(
          '[AgentExecutor.run] Dispatch result - state id:',
          dispatchResult?.state?.id,
          'chunks:',
          dispatchResult?.state?.chunkIds?.length,
        );
        turnsExecuted++;

        // Check if we should stop - waiting for external response
        if (this.shouldWaitForExternalResponse(responseEvent.type)) {
          console.log(
            '[AgentExecutor.run] Stopping - waiting for external response:',
            responseEvent.type,
          );
          break;
        }

        // For LLM_TEXT_RESPONSE, continue the loop - agent should call a tool to stop
        // The agent is expected to call ask_user, task_complete, or similar tools
        // to indicate it needs user input or has finished
        console.log(
          '[AgentExecutor.run] Continuing loop - LLM returned text response, waiting for tool call',
        );
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
      console.error('[AgentExecutor.run] Error during execution:', error);
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
  private async callLLMWithTimeout(
    messages: LLMMessage[],
  ): Promise<LLMCompletionResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await this.llmAdapter.complete({
        messages,
        tools:
          this.toolDefinitions.length > 0 ? this.toolDefinitions : undefined,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse LLM response to determine the appropriate event type
   * Handles tool calls and text responses
   */
  private parseResponseToEvent(response: LLMCompletionResponse): AgentEvent {
    const { EventType } =
      require('@team9/agent-framework') as typeof import('@team9/agent-framework');

    // Check for tool calls
    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolCall = response.toolCalls[0]; // Handle first tool call
      console.log(
        '[AgentExecutor] Tool call detected:',
        toolCall.name,
        toolCall.arguments,
      );

      return {
        type: EventType.LLM_TOOL_CALL,
        toolName: toolCall.name,
        callId: toolCall.id,
        arguments: toolCall.arguments,
        timestamp: Date.now(),
      };
    }

    // Plain text response
    return {
      type: EventType.LLM_TEXT_RESPONSE,
      content: response.content,
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
