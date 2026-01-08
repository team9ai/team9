/**
 * Turn Executor
 *
 * Executes a single LLM turn including context building, LLM calling,
 * response parsing, event dispatching, and tool call handling.
 */

import type { MemoryManager } from '../manager/memory.manager.js';
import type { LLMMessage, LLMToolDefinition } from '../llm/llm.types.js';
import type { ContextBuilder } from '../context/context-builder.js';
import type { AgentEvent } from '../types/event.types.js';
import type { LLMInteraction } from '../types/thread.types.js';
import type {
  IToolCallHandler,
  ToolCallHandlerContext,
  CancellationTokenSource,
} from './executor.types.js';
import { EventType } from '../types/event.types.js';
import { LLMCaller } from './llm-caller.js';
import { parseResponseToEvents } from './response-parser.js';

/**
 * Result of a single turn execution
 */
export interface SingleTurnResult {
  /** Whether the turn executed successfully */
  success: boolean;
  /** Whether the loop should stop after this turn */
  shouldStop: boolean;
  /** Last event type processed */
  lastEventType: string;
  /** LLM response content */
  responseContent?: string;
  /** Events generated during this turn */
  events: AgentEvent[];
  /** Error message if failed */
  error?: string;
  /** LLM interaction data for debugging */
  interaction?: LLMInteraction;
}

/**
 * TurnExecutor handles the execution of a single LLM turn
 */
export class TurnExecutor {
  constructor(
    private memoryManager: MemoryManager,
    private contextBuilder: ContextBuilder,
    private llmCaller: LLMCaller,
    private toolDefinitions: LLMToolDefinition[],
    private toolCallHandlers: IToolCallHandler[],
  ) {}

  /**
   * Execute a single LLM turn
   *
   * @param threadId - The thread ID
   * @param cancellation - Optional cancellation token source
   * @returns Result of the single turn execution
   */
  async execute(
    threadId: string,
    cancellation: CancellationTokenSource | null,
  ): Promise<SingleTurnResult> {
    const events: AgentEvent[] = [];

    const currentState = await this.memoryManager.getCurrentState(threadId);
    if (!currentState) {
      return {
        success: false,
        shouldStop: true,
        lastEventType: '',
        events,
        error: `Thread not found: ${threadId}`,
      };
    }

    // Build context for LLM
    const context = this.contextBuilder.build(currentState);
    const messages: LLMMessage[] = context.messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    console.log(
      '[TurnExecutor.execute] Calling LLM with',
      messages.length,
      'messages',
    );

    // Call LLM with tools
    const { response: llmResponse, interaction } =
      await this.llmCaller.callWithTimeout(
        { messages, toolDefinitions: this.toolDefinitions },
        { cancellation },
      );

    // Check for cancellation after LLM returns
    // If cancelled, discard the response and don't update state
    if (cancellation?.isCancellationRequested) {
      console.log(
        '[TurnExecutor.execute] Execution cancelled after LLM response - discarding response',
      );
      return {
        success: false,
        shouldStop: true,
        lastEventType: '',
        events,
        error: 'Cancelled',
        interaction,
      };
    }

    console.log('[TurnExecutor.execute] LLM response received:', {
      content: llmResponse.content?.substring(0, 100),
      toolCalls: llmResponse.toolCalls?.length ?? 0,
      finishReason: llmResponse.finishReason,
    });

    // Parse LLM response to determine event types (can be multiple)
    const responseEvents = parseResponseToEvents(llmResponse);
    events.push(...responseEvents);

    // Dispatch all response events sequentially
    let shouldStop = false;
    let lastEventType = '';
    for (const responseEvent of responseEvents) {
      console.log(
        '[TurnExecutor.execute] Dispatching response event:',
        responseEvent.type,
      );
      const dispatchResult = await this.memoryManager.dispatch(
        threadId,
        responseEvent,
      );
      console.log(
        '[TurnExecutor.execute] Dispatch result - state id:',
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
            '[TurnExecutor.execute] Found handler for tool:',
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
    await this.updateStepWithLLMInteraction(threadId, interaction);

    return {
      success: true,
      shouldStop,
      lastEventType,
      responseContent: llmResponse.content,
      events,
      interaction,
    };
  }

  /**
   * Find a handler that can process the given tool name
   */
  private findHandler(toolName: string): IToolCallHandler | undefined {
    return this.toolCallHandlers.find((h) => h.canHandle(toolName));
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
  private async updateStepWithLLMInteraction(
    threadId: string,
    interaction: LLMInteraction,
  ): Promise<void> {
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
          interaction,
        );
        console.log(
          '[TurnExecutor] Updated step with LLM interaction:',
          latestStep.id,
        );
      }
    } catch (error) {
      // Don't fail the execution if we can't update the step
      console.warn(
        '[TurnExecutor] Failed to update step with LLM interaction:',
        error,
      );
    }
  }
}

/**
 * Create a turn executor instance
 */
export function createTurnExecutor(
  memoryManager: MemoryManager,
  contextBuilder: ContextBuilder,
  llmCaller: LLMCaller,
  toolDefinitions: LLMToolDefinition[],
  toolCallHandlers: IToolCallHandler[],
): TurnExecutor {
  return new TurnExecutor(
    memoryManager,
    contextBuilder,
    llmCaller,
    toolDefinitions,
    toolCallHandlers,
  );
}
