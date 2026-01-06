/**
 * Agent Execution Service
 *
 * Handles agent execution: event injection, stepping, and LLM response generation.
 * Manages the execution flow and broadcasting of results.
 */

import type {
  AgentEvent,
  DispatchResult,
  StepResult,
} from '@team9/agent-framework';
import type { AgentRuntimeState, SSEEventType } from '../types/index.js';
import type { ExecutionResult } from '../executor/agent-executor.js';
import type { SSEBroadcaster } from './sse-broadcaster.service.js';

/**
 * Result of injecting an event
 */
export interface InjectEventResult {
  dispatchResult: DispatchResult;
  executionResult?: ExecutionResult;
}

/**
 * Configuration for AgentExecutionService
 */
export interface AgentExecutionServiceConfig {
  sseBroadcaster: SSEBroadcaster;
  isSteppingMode: (agentId: string) => boolean;
}

/**
 * AgentExecutionService handles event injection and stepping
 */
export class AgentExecutionService {
  constructor(
    private state: AgentRuntimeState,
    private config: AgentExecutionServiceConfig,
  ) {}

  /**
   * Broadcast SSE message
   */
  private broadcast(agentId: string, type: SSEEventType, data: unknown): void {
    this.config.sseBroadcaster.broadcast(agentId, type, data);
  }

  /**
   * Inject an event into an agent
   * @param autoRun - Whether to automatically run LLM after injection (default: true)
   */
  async injectEvent(
    agentId: string,
    event: AgentEvent,
    autoRun: boolean = true,
  ): Promise<InjectEventResult | null> {
    const controller = this.state.debugControllers.get(agentId);
    const agent = this.state.agentsCache.get(agentId);
    if (!controller || !agent) return null;

    // First, inject the event into memory
    const dispatchResult = await controller.injectEvent(agent.threadId, event);

    // Debug logging
    const isStepMode = this.config.isSteppingMode(agentId);
    const executor = this.state.executors.get(agentId);
    console.log(
      '[injectEvent] autoRun:',
      autoRun,
      'isStepMode:',
      isStepMode,
      'hasExecutor:',
      !!executor,
    );

    // If autoRun is enabled, not in stepping mode, and we have an executor, run the LLM loop
    // Run in background to avoid blocking the HTTP request
    if (autoRun && !isStepMode) {
      if (executor) {
        console.log('[injectEvent] Starting LLM execution loop (async)');
        this.broadcast(agentId, 'agent:thinking', { event });

        // Run asynchronously - don't await
        this.runExecutorAsync(agentId, executor, agent.threadId);
      }
    }

    return { dispatchResult };
  }

  /**
   * Run executor asynchronously (non-blocking)
   */
  private async runExecutorAsync(
    agentId: string,
    executor: { run: (threadId: string) => Promise<ExecutionResult> },
    threadId: string,
  ): Promise<void> {
    try {
      const executionResult = await executor.run(threadId);
      console.log(
        '[runExecutorAsync] Execution complete - success:',
        executionResult.success,
        'turns:',
        executionResult.turnsExecuted,
      );
      console.log(
        '[runExecutorAsync] Final state id:',
        executionResult.finalState?.id,
        'chunks:',
        executionResult.finalState?.chunkIds?.length,
      );

      if (executionResult.success) {
        this.broadcast(agentId, 'agent:response', {
          content: executionResult.lastResponse,
          turnsExecuted: executionResult.turnsExecuted,
        });
      } else {
        this.broadcast(agentId, 'agent:error', {
          error: executionResult.error,
        });
      }
    } catch (error) {
      console.error('Error running agent executor:', error);
      this.broadcast(agentId, 'agent:error', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Execute a single step in stepping mode
   *
   * Priority:
   * 1. Events in queue (processed by MemoryManager.step)
   * 2. Pending truncation (processed by MemoryManager.step)
   * 3. Pending compaction (processed by MemoryManager.step)
   * 4. LLM response generation (only if needsResponse is true)
   */
  async step(agentId: string): Promise<StepResult | null> {
    const controller = this.state.debugControllers.get(agentId);
    const agent = this.state.agentsCache.get(agentId);
    const memoryManager = this.state.memoryManagers.get(agentId);
    if (!controller || !agent || !memoryManager) return null;

    // Step 1: Call MemoryManager.step() for events/truncation/compaction
    const memoryResult = await controller.step(agent.threadId);

    // Handle interrupt if needed
    if (memoryResult.shouldInterrupt) {
      this.state.executors.get(agentId)?.cancel(agent.threadId);
    }

    // If memory operation was performed, return (Observer handles step recording)
    if (
      memoryResult.eventProcessed ||
      memoryResult.truncationPerformed ||
      memoryResult.compactionPerformed
    ) {
      this.broadcastStepResult(agentId, memoryResult, false);
      return memoryResult;
    }

    // Step 2: No pending operations - check if LLM response needed
    const executor = this.state.executors.get(agentId);
    if (!executor || !memoryResult.needsResponse) {
      // No-op: nothing to do, no step recorded
      this.broadcastStepResult(agentId, memoryResult, false);
      return memoryResult;
    }

    // Step 3: Generate LLM response
    this.broadcast(agentId, 'agent:thinking', {});

    try {
      const executionResult = await executor.runSingleTurn(agent.threadId);

      if (executionResult.success && executionResult.turnsExecuted > 0) {
        await memoryManager.setNeedsResponse(agent.threadId, false);
      }

      // Observer handles step recording via onStateChange

      const updatedResult = await this.buildStepResult(
        agent.threadId,
        memoryManager,
      );
      this.broadcastStepResult(
        agentId,
        updatedResult,
        executionResult.success && executionResult.turnsExecuted > 0,
        executionResult.lastResponse,
      );

      return updatedResult;
    } catch (error) {
      console.error('Error in step LLM execution:', error);
      // Observer handles error recording via onError
      this.broadcast(agentId, 'agent:error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return memoryResult;
    }
  }

  /**
   * Build step result from current state
   */
  private async buildStepResult(
    threadId: string,
    memoryManager: {
      getPersistentQueueLength: (threadId: string) => Promise<number>;
      needsResponse: (threadId: string) => Promise<boolean>;
      getCurrentState: (threadId: string) => Promise<unknown>;
      getThread: (threadId: string) => Promise<unknown>;
      hasPendingCompaction: (threadId: string) => boolean;
      hasPendingTruncation: (threadId: string) => boolean;
    },
  ): Promise<StepResult> {
    const queueLength = await memoryManager.getPersistentQueueLength(threadId);
    const needsResponse = await memoryManager.needsResponse(threadId);
    const finalState = await memoryManager.getCurrentState(threadId);
    const thread = await memoryManager.getThread(threadId);

    return {
      dispatchResult:
        thread && finalState
          ? ({
              thread,
              state: finalState,
              addedChunks: [],
              removedChunkIds: [],
            } as any)
          : null,
      eventProcessed: false,
      compactionPerformed: false,
      truncationPerformed: false,
      hasPendingOperations:
        queueLength > 0 ||
        memoryManager.hasPendingCompaction(threadId) ||
        memoryManager.hasPendingTruncation(threadId),
      queuedEventCount: queueLength,
      needsResponse,
    };
  }

  /**
   * Broadcast step result to SSE subscribers
   */
  private broadcastStepResult(
    agentId: string,
    result: StepResult,
    llmResponseGenerated: boolean,
    lastResponse?: string,
  ): void {
    if (result.shouldTerminate) {
      this.broadcast(agentId, 'agent:terminated', {
        eventProcessed: result.eventProcessed,
        reason: 'terminate_event',
      });
    } else {
      this.broadcast(agentId, 'agent:stepped', {
        eventProcessed: result.eventProcessed,
        truncationPerformed: result.truncationPerformed,
        compactionPerformed: result.compactionPerformed,
        hasPendingOperations: result.hasPendingOperations,
        queuedEventCount: result.queuedEventCount,
        needsResponse: result.needsResponse,
        llmResponseGenerated,
        lastResponse,
        shouldTerminate: result.shouldTerminate,
        shouldInterrupt: result.shouldInterrupt,
      });
    }
  }
}

/**
 * Create an agent execution service instance
 */
export function createAgentExecutionService(
  state: AgentRuntimeState,
  config: AgentExecutionServiceConfig,
): AgentExecutionService {
  return new AgentExecutionService(state, config);
}
