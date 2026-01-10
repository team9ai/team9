/**
 * LLM Loop Executor
 *
 * Core LLM response generation loop that orchestrates turn execution.
 * Tool execution is delegated to IToolCallHandler implementations.
 *
 * Cancellation:
 * - External code can call cancel() to request cancellation
 * - If cancelled during LLM call, the response is discarded (no state change)
 * - The result will have cancelled=true
 */

import type { AgentOrchestrator } from '../manager/agent-orchestrator.js';
import type { AgentEvent } from '../types/event.types.js';
import type { ILLMAdapter, LLMToolDefinition } from '../llm/llm.types.js';
import type {
  LLMLoopExecutorConfig,
  ResolvedLLMLoopConfig,
  LLMLoopExecutionResult,
} from './executor.types.js';
import { CancellationTokenSource } from './executor.types.js';
import { createContextBuilder } from '../context/context-builder.js';
import { getToolsByNames } from '../tools/index.js';
import { LLMCaller } from './llm-caller.js';
import { TurnExecutor } from './turn-executor.js';

/**
 * LLMLoopExecutor handles the LLM response generation loop
 *
 * Flow:
 * 1. Build context from Memory state
 * 2. Call LLM to generate a response (with tools)
 * 3. Parse response to events and dispatch them
 * 4. For tool calls, delegate to registered IToolCallHandler
 * 5. Loop continues until: stop event, max turns, or cancelled
 */
export class LLMLoopExecutor {
  private config: ResolvedLLMLoopConfig;
  private turnExecutor: TurnExecutor;

  /** Current cancellation token source for the running execution */
  private currentCancellation: CancellationTokenSource | null = null;
  /** Thread ID of current execution */
  private currentThreadId: string | null = null;

  constructor(
    private orchestrator: AgentOrchestrator,
    llmAdapter: ILLMAdapter,
    config: LLMLoopExecutorConfig = {},
  ) {
    this.config = {
      maxTurns: config.maxTurns ?? 10,
      timeout: config.timeout ?? 60000,
      tools: config.tools ?? [],
      toolCallHandlers: config.toolCallHandlers ?? [],
    };

    // Create context builder
    const contextBuilder = createContextBuilder();

    // Get control tool definitions for LLM (only control tools are directly callable)
    const controlTools = getToolsByNames(this.config.tools);
    const toolDefinitions: LLMToolDefinition[] = controlTools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    // Create LLM caller
    const llmCaller = new LLMCaller(llmAdapter, this.config.timeout);

    // Create turn executor
    this.turnExecutor = new TurnExecutor(
      this.orchestrator,
      contextBuilder,
      llmCaller,
      toolDefinitions,
      this.config.toolCallHandlers,
    );

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
   * Run a single LLM turn (for stepping mode)
   *
   * This method executes exactly one LLM call and returns.
   * Used by AgentService.step() when needsResponse is true.
   *
   * @param threadId - The thread ID to run for
   * @returns Execution result for the single turn
   */
  async runSingleTurn(threadId: string): Promise<LLMLoopExecutionResult> {
    // Set up cancellation for this single turn
    this.currentCancellation = new CancellationTokenSource();
    this.currentThreadId = threadId;

    try {
      console.log('[LLMLoopExecutor.runSingleTurn] Executing single turn');

      // Check for cancellation
      if (this.currentCancellation.isCancellationRequested) {
        const finalState = await this.orchestrator.getCurrentState(threadId);
        return {
          success: false,
          finalState: finalState!,
          turnsExecuted: 0,
          events: [],
          cancelled: true,
        };
      }

      // Execute single turn
      const turnResult = await this.turnExecutor.execute(
        threadId,
        this.currentCancellation,
      );

      const finalState = await this.orchestrator.getCurrentState(threadId);
      if (!finalState) {
        throw new Error(`Thread not found: ${threadId}`);
      }

      if (!turnResult.success) {
        return {
          success: false,
          finalState,
          turnsExecuted: turnResult.error ? 0 : 1,
          lastResponse: turnResult.responseContent,
          error: turnResult.error,
          events: turnResult.events,
          cancelled: this.currentCancellation?.isCancellationRequested,
        };
      }

      return {
        success: true,
        finalState,
        turnsExecuted: 1,
        lastResponse: turnResult.responseContent,
        events: turnResult.events,
      };
    } catch (error) {
      console.error(
        '[LLMLoopExecutor.runSingleTurn] Error during execution:',
        error,
      );
      const finalState = await this.orchestrator.getCurrentState(threadId);
      return {
        success: false,
        finalState: finalState!,
        turnsExecuted: 0,
        error: error instanceof Error ? error.message : String(error),
        events: [],
        cancelled: this.currentCancellation?.isCancellationRequested,
      };
    } finally {
      // Clear cancellation state
      this.currentCancellation = null;
      this.currentThreadId = null;
    }
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
          const finalState = await this.orchestrator.getCurrentState(threadId);
          return {
            success: false,
            finalState: finalState!,
            turnsExecuted,
            lastResponse,
            events,
            cancelled: true,
          };
        }

        // Execute single turn
        const turnResult = await this.turnExecutor.execute(
          threadId,
          this.currentCancellation,
        );
        events.push(...turnResult.events);

        if (!turnResult.success) {
          // Turn failed (possibly cancelled during LLM call)
          const finalState = await this.orchestrator.getCurrentState(threadId);
          return {
            success: false,
            finalState: finalState!,
            turnsExecuted,
            lastResponse,
            error: turnResult.error,
            events,
            cancelled: this.currentCancellation?.isCancellationRequested,
          };
        }

        lastResponse = turnResult.responseContent ?? lastResponse;
        turnsExecuted++;

        // Check if we should stop - waiting for external response
        if (turnResult.shouldStop) {
          console.log(
            '[LLMLoopExecutor.run] Stopping - waiting for external response:',
            turnResult.lastEventType,
          );
          break;
        }

        // For LLM_TEXT_RESPONSE only, continue the loop - agent should call a tool to stop
        console.log(
          '[LLMLoopExecutor.run] Continuing loop - LLM returned text response, waiting for tool call',
        );
      }

      const finalState = await this.orchestrator.getCurrentState(threadId);
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
      const finalState = await this.orchestrator.getCurrentState(threadId);
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
}

/**
 * Create an LLM loop executor
 */
export function createLLMLoopExecutor(
  orchestrator: AgentOrchestrator,
  llmAdapter: ILLMAdapter,
  config?: LLMLoopExecutorConfig,
): LLMLoopExecutor {
  return new LLMLoopExecutor(orchestrator, llmAdapter, config);
}
