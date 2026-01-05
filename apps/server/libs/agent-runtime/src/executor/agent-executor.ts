import type {
  MemoryManager,
  MemoryState,
  ILLMAdapter,
  LLMMessage,
  LLMToolDefinition,
  LLMCompletionResponse,
  AgentEvent,
  ContextBuilder,
  LLMInteraction,
  CustomToolConfig,
  IToolRegistry,
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
  /** Available control tool names for this agent */
  tools?: string[];
  /** Custom external tools (registered as common tools by default) */
  customTools?: CustomToolConfig[];
  /** Complete tool registry instance (overrides tools and customTools) */
  toolRegistry?: IToolRegistry;
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
  /** Whether execution was cancelled */
  cancelled?: boolean;
}

/**
 * Cancellation token for interrupting LLM execution
 */
export interface CancellationToken {
  /** Whether cancellation has been requested */
  readonly isCancellationRequested: boolean;
  /** Register a callback to be called when cancellation is requested */
  onCancellationRequested(callback: () => void): void;
}

/**
 * Cancellation token source for creating and controlling cancellation tokens
 * Wraps an AbortController to support native abort signals for LLM API calls
 */
export class CancellationTokenSource {
  private _isCancellationRequested = false;
  private callbacks: (() => void)[] = [];
  private abortController: AbortController;

  constructor() {
    this.abortController = new AbortController();
  }

  get token(): CancellationToken {
    return {
      isCancellationRequested: this._isCancellationRequested,
      onCancellationRequested: (callback: () => void) => {
        if (this._isCancellationRequested) {
          callback();
        } else {
          this.callbacks.push(callback);
        }
      },
    };
  }

  /**
   * Get the abort signal for passing to LLM API calls
   * This allows actual cancellation of in-flight HTTP requests
   */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  cancel(): void {
    if (this._isCancellationRequested) return;
    this._isCancellationRequested = true;
    // Abort any in-flight requests
    this.abortController.abort();
    this.callbacks.forEach((cb) => cb());
    this.callbacks = [];
  }

  get isCancellationRequested(): boolean {
    return this._isCancellationRequested;
  }
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
 * 6. Loop stops when: tool call, max turns reached, task ended, or cancelled
 *
 * Cancellation:
 * - External code can call cancel() to request cancellation
 * - If cancelled during LLM call, the response is discarded (no state change)
 * - The result will have cancelled=true
 */
export class AgentExecutor {
  private config: ResolvedConfig;
  private contextBuilder: ContextBuilder;
  private toolDefinitions: LLMToolDefinition[];
  private _toolRegistry: IToolRegistry;
  /** Current cancellation token source for the running execution */
  private currentCancellation: CancellationTokenSource | null = null;
  /** Thread ID of current execution */
  private currentThreadId: string | null = null;

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
    const { createContextBuilder, getToolsByNames, createDefaultToolRegistry } =
      require('@team9/agent-framework') as typeof import('@team9/agent-framework');
    this.contextBuilder = createContextBuilder();

    // Initialize tool registry
    this._toolRegistry = this.initializeToolRegistry(
      config,
      createDefaultToolRegistry,
    );

    // Get control tool definitions for LLM (only control tools are directly callable)
    const controlTools = getToolsByNames(this.config.tools);
    this.toolDefinitions = controlTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    console.log(
      '[AgentExecutor] Initialized with control tools:',
      this.config.tools,
    );
    console.log(
      '[AgentExecutor] Tool registry has',
      this._toolRegistry.getAllToolNames().length,
      'tools',
    );
  }

  /**
   * Initialize tool registry with control tools and custom tools
   */
  private initializeToolRegistry(
    config: AgentExecutorConfig,
    createDefaultToolRegistry: () => IToolRegistry,
  ): IToolRegistry {
    // If a complete registry is provided, use it directly
    if (config.toolRegistry) {
      return config.toolRegistry;
    }

    // Create default registry with control tools
    const registry = createDefaultToolRegistry();

    // Register custom tools
    if (config.customTools && config.customTools.length > 0) {
      for (const custom of config.customTools) {
        registry.register({
          definition: custom.definition,
          executor: custom.executor,
          category: custom.category ?? 'common',
        });
      }
      console.log(
        '[AgentExecutor] Registered',
        config.customTools.length,
        'custom tools',
      );
    }

    return registry;
  }

  /**
   * Get the tool registry for external access (e.g., for invoke_tool handling)
   */
  get toolRegistry(): IToolRegistry {
    return this._toolRegistry;
  }

  /**
   * Cancel any currently running execution for the given thread
   * If an LLM call is in progress, the response will be discarded when it returns
   *
   * @param threadId - Optional thread ID to cancel. If not provided, cancels current execution.
   * @returns true if there was an execution to cancel, false otherwise
   */
  cancel(threadId?: string): boolean {
    if (!this.currentCancellation) {
      return false;
    }

    // If threadId is provided, only cancel if it matches
    if (threadId && this.currentThreadId !== threadId) {
      return false;
    }

    console.log(
      '[AgentExecutor.cancel] Cancelling execution for thread:',
      this.currentThreadId,
    );
    this.currentCancellation.cancel();
    return true;
  }

  /**
   * Check if execution is currently running
   */
  isRunning(): boolean {
    return this.currentCancellation !== null;
  }

  /**
   * Check if execution is cancelled
   */
  isCancelled(): boolean {
    return this.currentCancellation?.isCancellationRequested ?? false;
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
   * - Cancelled via cancel()
   */
  async run(threadId: string): Promise<ExecutionResult> {
    const events: AgentEvent[] = [];
    let turnsExecuted = 0;
    let lastResponse: string | undefined;

    // Set up cancellation
    this.currentCancellation = new CancellationTokenSource();
    this.currentThreadId = threadId;

    try {
      console.log(
        '[AgentExecutor.run] Starting execution loop, maxTurns:',
        this.config.maxTurns,
      );

      while (turnsExecuted < this.config.maxTurns) {
        // Check for cancellation at the start of each turn
        if (this.currentCancellation.isCancellationRequested) {
          console.log('[AgentExecutor.run] Execution cancelled before turn');
          const finalState = await this.memoryManager.getCurrentState(threadId);
          return {
            success: false,
            finalState: finalState!,
            turnsExecuted,
            lastResponse,
            events,
            cancelled: true,
          };
        }

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

        // Inject available external tools list into context if there are any
        const toolsList = this._toolRegistry.formatToolListForContext();
        if (toolsList) {
          // Add tools list as a system message at the end
          messages.push({
            role: 'system',
            content: toolsList,
          });
        }

        console.log(
          '[AgentExecutor.run] Calling LLM with',
          messages.length,
          'messages and',
          this.toolDefinitions.length,
          'tools',
        );

        // Call LLM with tools
        const llmResponse = await this.callLLMWithTimeout(messages);

        // Check for cancellation after LLM returns
        // If cancelled, discard the response and don't update state
        if (this.currentCancellation.isCancellationRequested) {
          console.log(
            '[AgentExecutor.run] Execution cancelled after LLM response - discarding response',
          );
          const finalState = await this.memoryManager.getCurrentState(threadId);
          return {
            success: false,
            finalState: finalState!,
            turnsExecuted,
            lastResponse,
            events,
            cancelled: true,
          };
        }

        console.log('[AgentExecutor.run] LLM response received:', {
          content: llmResponse.content?.substring(0, 100),
          toolCalls: llmResponse.toolCalls?.length ?? 0,
          finishReason: llmResponse.finishReason,
        });
        lastResponse = llmResponse.content;

        // Parse LLM response to determine event types (can be multiple)
        const responseEvents = this.parseResponseToEvents(llmResponse);
        events.push(...responseEvents);

        const { EventType } =
          require('@team9/agent-framework') as typeof import('@team9/agent-framework');

        // Dispatch all response events sequentially
        let shouldStop = false;
        let lastEventType = '';
        for (const responseEvent of responseEvents) {
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
          lastEventType = responseEvent.type;

          // Check if this is an invoke_tool call - auto-execute it
          if (
            responseEvent.type === EventType.LLM_TOOL_CALL &&
            (responseEvent as { toolName?: string }).toolName === 'invoke_tool'
          ) {
            const toolCallEvent = responseEvent as {
              callId: string;
              toolName: string;
              arguments: {
                tool_name?: string;
                arguments?: Record<string, unknown>;
              };
            };

            const externalToolName = toolCallEvent.arguments?.tool_name;
            const externalToolArgs = toolCallEvent.arguments?.arguments ?? {};

            if (externalToolName) {
              console.log(
                '[AgentExecutor.run] Auto-executing invoke_tool:',
                externalToolName,
                externalToolArgs,
              );

              // Execute the external tool
              const toolResult = await this._toolRegistry.execute(
                externalToolName,
                externalToolArgs,
                {
                  threadId,
                  callId: toolCallEvent.callId,
                },
              );

              console.log(
                '[AgentExecutor.run] Tool result:',
                toolResult.success,
                toolResult.content,
              );

              // Inject TOOL_RESULT event
              const resultContent = toolResult.success
                ? toolResult.content
                : { error: toolResult.error, content: toolResult.content };

              const toolResultEvent: AgentEvent = {
                type: EventType.TOOL_RESULT,
                toolName: externalToolName,
                callId: toolCallEvent.callId,
                success: toolResult.success,
                result: resultContent,
                timestamp: Date.now(),
              };

              // Dispatch the result
              await this.memoryManager.dispatch(threadId, toolResultEvent);
              events.push(toolResultEvent);

              // Don't stop - continue the loop after tool execution
              continue;
            }
          }

          // Check if this event type requires stopping
          if (this.shouldWaitForExternalResponse(responseEvent.type)) {
            shouldStop = true;
          }
        }

        // Update the first step with LLM interaction data for debugging
        // (the LLM interaction applies to the first event from this LLM call)
        if (this.lastLLMInteraction) {
          try {
            // Get the most recent step for this thread (created during dispatch)
            const steps = await this.memoryManager.getStepsByThread(threadId);
            if (steps.length > 0) {
              // Sort by startedAt descending to get the most recent step
              const sortedSteps = [...steps].sort(
                (a, b) => b.startedAt - a.startedAt,
              );
              const latestStep = sortedSteps[0];
              await this.memoryManager.updateStepLLMInteraction(
                latestStep.id,
                this.lastLLMInteraction,
              );
              console.log(
                '[AgentExecutor.run] Updated step with LLM interaction:',
                latestStep.id,
              );
            }
          } catch (error) {
            // Don't fail the execution if we can't update the step
            console.warn(
              '[AgentExecutor.run] Failed to update step with LLM interaction:',
              error,
            );
          }
          this.lastLLMInteraction = null;
        }

        turnsExecuted++;

        // Check if we should stop - waiting for external response
        if (shouldStop) {
          console.log(
            '[AgentExecutor.run] Stopping - waiting for external response:',
            lastEventType,
          );
          break;
        }

        // For LLM_TEXT_RESPONSE only, continue the loop - agent should call a tool to stop
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
        cancelled: this.currentCancellation?.isCancellationRequested,
      };
    } finally {
      // Clear cancellation state
      this.currentCancellation = null;
      this.currentThreadId = null;
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
   * Result of LLM call including interaction data for debugging
   */
  private lastLLMInteraction: LLMInteraction | null = null;

  /**
   * Call LLM with timeout and cancellation support
   * Combines timeout abort with cancellation abort using AbortSignal.any()
   * Also captures the LLM interaction data for debugging
   */
  private async callLLMWithTimeout(
    messages: LLMMessage[],
  ): Promise<LLMCompletionResponse> {
    // Create timeout abort controller
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(
      () => timeoutController.abort(new Error('LLM call timeout')),
      this.config.timeout,
    );

    // Combine timeout signal with cancellation signal
    // If either aborts, the combined signal will abort
    const signals: AbortSignal[] = [timeoutController.signal];
    if (this.currentCancellation) {
      signals.push(this.currentCancellation.signal);
    }
    const combinedSignal = AbortSignal.any(signals);

    // Capture LLM interaction start
    const startedAt = Date.now();
    const llmInteraction: LLMInteraction = {
      startedAt,
      request: {
        messages,
        tools:
          this.toolDefinitions.length > 0 ? this.toolDefinitions : undefined,
      },
    };

    try {
      const response = await this.llmAdapter.complete({
        messages,
        tools:
          this.toolDefinitions.length > 0 ? this.toolDefinitions : undefined,
        signal: combinedSignal,
      });

      // Capture LLM interaction completion
      const completedAt = Date.now();
      llmInteraction.completedAt = completedAt;
      llmInteraction.duration = completedAt - startedAt;
      llmInteraction.response = {
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

      this.lastLLMInteraction = llmInteraction;
      return response;
    } catch (error) {
      // Capture error in LLM interaction
      const completedAt = Date.now();
      llmInteraction.completedAt = completedAt;
      llmInteraction.duration = completedAt - startedAt;
      llmInteraction.error =
        error instanceof Error ? error.message : String(error);
      this.lastLLMInteraction = llmInteraction;

      // Check if this was a cancellation (not timeout)
      if (this.currentCancellation?.isCancellationRequested) {
        throw new Error('LLM call cancelled');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Parse LLM response to determine the appropriate event types
   * Returns an array of events since LLM can return both text and tool calls simultaneously
   */
  private parseResponseToEvents(response: LLMCompletionResponse): AgentEvent[] {
    const { EventType } =
      require('@team9/agent-framework') as typeof import('@team9/agent-framework');

    const events: AgentEvent[] = [];
    const timestamp = Date.now();

    // First, add text response event if there's content
    if (response.content && response.content.trim()) {
      events.push({
        type: EventType.LLM_TEXT_RESPONSE,
        content: response.content,
        timestamp,
      });
    }

    // Then, add tool call events for each tool call
    if (response.toolCalls && response.toolCalls.length > 0) {
      for (const toolCall of response.toolCalls) {
        console.log(
          '[AgentExecutor] Tool call detected:',
          toolCall.name,
          toolCall.arguments,
        );
        events.push({
          type: EventType.LLM_TOOL_CALL,
          toolName: toolCall.name,
          callId: toolCall.id,
          arguments: toolCall.arguments,
          timestamp,
        });
      }
    }

    // If no events were created (empty response), create an empty text response
    if (events.length === 0) {
      events.push({
        type: EventType.LLM_TEXT_RESPONSE,
        content: '',
        timestamp,
      });
    }

    return events;
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
