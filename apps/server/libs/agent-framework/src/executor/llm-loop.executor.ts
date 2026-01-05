/**
 * LLM Loop Executor
 *
 * Core LLM response generation loop that is agnostic to specific tool implementations.
 * Tool execution is delegated to IToolCallHandler implementations.
 */

import type { MemoryManager } from '../manager/memory.manager.js';
import type { MemoryState } from '../types/state.types.js';
import type { AgentEvent } from '../types/event.types.js';
import type {
  ILLMAdapter,
  LLMMessage,
  LLMToolDefinition,
  LLMCompletionResponse,
} from '../llm/llm.types.js';
import type { LLMInteraction } from '../types/thread.types.js';
import type { ContextBuilder } from '../context/context-builder.js';
import {
  CancellationTokenSource,
  type LLMLoopExecutorConfig,
  type ResolvedLLMLoopConfig,
  type LLMLoopExecutionResult,
  type IToolCallHandler,
  type ToolCallHandlerContext,
} from './executor.types.js';
import { EventType } from '../types/event.types.js';
import { createContextBuilder } from '../context/context-builder.js';
import { getToolsByNames } from '../tools/index.js';

/**
 * LLMLoopExecutor handles the pure LLM response generation loop
 *
 * Flow:
 * 1. Build context from Memory state
 * 2. Call LLM to generate a response (with tools)
 * 3. Parse response to events and dispatch them
 * 4. For tool calls, delegate to registered IToolCallHandler
 * 5. Loop continues until: stop event, max turns, or cancelled
 *
 * Cancellation:
 * - External code can call cancel() to request cancellation
 * - If cancelled during LLM call, the response is discarded (no state change)
 * - The result will have cancelled=true
 */
export class LLMLoopExecutor {
  private config: ResolvedLLMLoopConfig;
  private contextBuilder: ContextBuilder;
  private toolDefinitions: LLMToolDefinition[];

  /** Current cancellation token source for the running execution */
  private currentCancellation: CancellationTokenSource | null = null;
  /** Thread ID of current execution */
  private currentThreadId: string | null = null;
  /** Result of LLM call including interaction data for debugging */
  private lastLLMInteraction: LLMInteraction | null = null;

  constructor(
    private memoryManager: MemoryManager,
    private llmAdapter: ILLMAdapter,
    config: LLMLoopExecutorConfig = {},
  ) {
    this.config = {
      maxTurns: config.maxTurns ?? 10,
      timeout: config.timeout ?? 60000,
      tools: config.tools ?? [],
      toolCallHandlers: config.toolCallHandlers ?? [],
    };

    // Create context builder
    this.contextBuilder = createContextBuilder();

    // Get control tool definitions for LLM (only control tools are directly callable)
    const controlTools = getToolsByNames(this.config.tools);
    this.toolDefinitions = controlTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    console.log(
      '[LLMLoopExecutor] Initialized with control tools:',
      this.config.tools,
    );
    console.log(
      '[LLMLoopExecutor] Tool call handlers:',
      this.config.toolCallHandlers.length,
    );
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
      '[LLMLoopExecutor.cancel] Cancelling execution for thread:',
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
   * Run LLM loop until it needs to wait for external response or reaches max turns
   *
   * Continues running when:
   * - LLM_TEXT_RESPONSE: just output, can continue
   * - Tool call handler returns shouldContinue=true
   *
   * Stops running when:
   * - Tool call with no handler or handler returns shouldContinue=false
   * - LLM_SKILL_CALL, LLM_SUBAGENT_SPAWN, LLM_CLARIFICATION: wait for external
   * - TASK_COMPLETED/TASK_ABANDONED/TASK_TERMINATED: task ended
   * - Max turns reached
   * - Cancelled via cancel()
   */
  async run(threadId: string): Promise<LLMLoopExecutionResult> {
    const events: AgentEvent[] = [];
    let turnsExecuted = 0;
    let lastResponse: string | undefined;

    // Set up cancellation
    this.currentCancellation = new CancellationTokenSource();
    this.currentThreadId = threadId;

    try {
      console.log(
        '[LLMLoopExecutor.run] Starting execution loop, maxTurns:',
        this.config.maxTurns,
      );

      while (turnsExecuted < this.config.maxTurns) {
        // Check for cancellation at the start of each turn
        if (this.currentCancellation.isCancellationRequested) {
          console.log('[LLMLoopExecutor.run] Execution cancelled before turn');
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

        console.log(
          '[LLMLoopExecutor.run] Calling LLM with',
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
            '[LLMLoopExecutor.run] Execution cancelled after LLM response - discarding response',
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

        console.log('[LLMLoopExecutor.run] LLM response received:', {
          content: llmResponse.content?.substring(0, 100),
          toolCalls: llmResponse.toolCalls?.length ?? 0,
          finishReason: llmResponse.finishReason,
        });
        lastResponse = llmResponse.content;

        // Parse LLM response to determine event types (can be multiple)
        const responseEvents = this.parseResponseToEvents(llmResponse);
        events.push(...responseEvents);

        // Dispatch all response events sequentially
        let shouldStop = false;
        let lastEventType = '';
        for (const responseEvent of responseEvents) {
          console.log(
            '[LLMLoopExecutor.run] Dispatching response event:',
            responseEvent.type,
          );
          const dispatchResult = await this.memoryManager.dispatch(
            threadId,
            responseEvent,
          );
          console.log(
            '[LLMLoopExecutor.run] Dispatch result - state id:',
            dispatchResult?.state?.id,
            'chunks:',
            dispatchResult?.state?.chunkIds?.length,
          );
          lastEventType = responseEvent.type;

          // Check if this is a tool call that can be handled
          if (responseEvent.type === EventType.LLM_TOOL_CALL) {
            const toolCallEvent = responseEvent as {
              callId: string;
              toolName: string;
              arguments: Record<string, unknown>;
            };

            // Find a handler for this tool call
            const handler = this.findHandler(toolCallEvent.toolName);
            if (handler) {
              console.log(
                '[LLMLoopExecutor.run] Found handler for tool:',
                toolCallEvent.toolName,
              );

              const handlerContext: ToolCallHandlerContext = {
                threadId,
                callId: toolCallEvent.callId,
                memoryManager: this.memoryManager,
              };

              const handlerResult = await handler.handle(
                toolCallEvent.toolName,
                toolCallEvent.arguments,
                handlerContext,
              );

              // Dispatch any result events from the handler
              if (handlerResult.resultEvents) {
                for (const resultEvent of handlerResult.resultEvents) {
                  await this.memoryManager.dispatch(threadId, resultEvent);
                  events.push(resultEvent);
                }
              }

              if (handlerResult.shouldContinue) {
                // Handler processed the tool call and wants to continue
                continue;
              } else {
                // Handler wants to stop the loop
                shouldStop = true;
              }
            } else {
              // No handler found, stop and wait for external handling
              shouldStop = true;
            }
          } else if (this.shouldWaitForExternalResponse(responseEvent.type)) {
            // Check if this event type requires stopping
            shouldStop = true;
          }
        }

        // Update the step with LLM interaction data for debugging
        if (this.lastLLMInteraction) {
          await this.updateStepWithLLMInteraction(threadId);
          this.lastLLMInteraction = null;
        }

        turnsExecuted++;

        // Check if we should stop - waiting for external response
        if (shouldStop) {
          console.log(
            '[LLMLoopExecutor.run] Stopping - waiting for external response:',
            lastEventType,
          );
          break;
        }

        // For LLM_TEXT_RESPONSE only, continue the loop - agent should call a tool to stop
        console.log(
          '[LLMLoopExecutor.run] Continuing loop - LLM returned text response, waiting for tool call',
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
      console.error('[LLMLoopExecutor.run] Error during execution:', error);
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
   * Find a handler that can process the given tool name
   */
  private findHandler(toolName: string): IToolCallHandler | undefined {
    return this.config.toolCallHandlers.find((h) => h.canHandle(toolName));
  }

  /**
   * Check if the event type requires waiting for external response
   */
  private shouldWaitForExternalResponse(eventType: string): boolean {
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
   * Update the most recent step with LLM interaction data for debugging
   */
  private async updateStepWithLLMInteraction(threadId: string): Promise<void> {
    if (!this.lastLLMInteraction) return;

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
          '[LLMLoopExecutor.run] Updated step with LLM interaction:',
          latestStep.id,
        );
      }
    } catch (error) {
      // Don't fail the execution if we can't update the step
      console.warn(
        '[LLMLoopExecutor.run] Failed to update step with LLM interaction:',
        error,
      );
    }
  }

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
          '[LLMLoopExecutor] Tool call detected:',
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
 * Create an LLM loop executor
 */
export function createLLMLoopExecutor(
  memoryManager: MemoryManager,
  llmAdapter: ILLMAdapter,
  config?: LLMLoopExecutorConfig,
): LLMLoopExecutor {
  return new LLMLoopExecutor(memoryManager, llmAdapter, config);
}
