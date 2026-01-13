/**
 * Agent Execution Service
 *
 * Handles agent execution: event injection, stepping, and LLM response generation.
 * Uses Agent methods for dispatch/step operations.
 * Also handles subagent lifecycle and result propagation.
 */

import type {
  BaseEvent,
  DispatchResult,
  StepResult,
} from '@team9/agent-framework';
import { EventType } from '@team9/agent-framework';
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
    event: BaseEvent,
    autoRun: boolean = true,
  ): Promise<InjectEventResult | null> {
    const agent = this.state.agents.get(agentId);
    const agentInstance = this.state.agentsCache.get(agentId);
    if (!agent || !agentInstance) return null;

    // First, dispatch the event using Agent
    const dispatchResult = await agent.dispatch(event);

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
        this.runExecutorAsync(agentId, executor, agentInstance.threadId);
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
   * 1. Events in queue (processed by Agent.step)
   * 2. Pending compaction (processed by Agent.step)
   * 3. LLM response generation (only if needLLMContinueResponse is true)
   *
   * Note: Truncation is now handled non-destructively in TurnExecutor before LLM calls.
   */
  async step(agentId: string): Promise<StepResult | null> {
    const agent = this.state.agents.get(agentId);
    const agentInstance = this.state.agentsCache.get(agentId);
    if (!agent || !agentInstance) return null;

    // Step 1: Call Agent.step() for events/truncation/compaction
    const memoryResult = await agent.step();

    // Handle interrupt if needed
    if (memoryResult.shouldInterrupt) {
      this.state.executors.get(agentId)?.cancel(agentInstance.threadId);
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
    if (!executor || !memoryResult.needLLMContinueResponse) {
      // No-op: nothing to do, no step recorded
      this.broadcastStepResult(agentId, memoryResult, false);
      return memoryResult;
    }

    // Step 3: Generate LLM response
    this.broadcast(agentId, 'agent:thinking', {});

    try {
      const executionResult = await executor.runSingleTurn(
        agentInstance.threadId,
      );

      // Observer handles step recording via onStateChange

      const updatedResult = await this.buildStepResult(agentId);
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
  private async buildStepResult(agentId: string): Promise<StepResult> {
    const agent = this.state.agents.get(agentId);
    const agentInstance = this.state.agentsCache.get(agentId);
    if (!agent || !agentInstance) {
      return {
        dispatchResult: null,
        eventProcessed: false,
        compactionPerformed: false,
        truncationPerformed: false,
        hasPendingOperations: false,
        queuedEventCount: 0,
        needLLMContinueResponse: false,
      };
    }

    const orchestrator = agent.getOrchestrator();
    const threadId = agentInstance.threadId;

    const queueLength = await orchestrator.getPersistentQueueLength(threadId);
    const needsResponse = await orchestrator.needLLMContinueResponse(threadId);
    const finalState = await agent.getState();
    const thread = await agent.getThread();

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
      hasPendingOperations: queueLength > 0,
      queuedEventCount: queueLength,
      needLLMContinueResponse: needsResponse,
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
        needLLMContinueResponse: result.needLLMContinueResponse,
        llmResponseGenerated,
        lastResponse,
        shouldTerminate: result.shouldTerminate,
        shouldInterrupt: result.shouldInterrupt,
      });
    }
  }

  // ============ Subagent Operations ============

  /**
   * Handle subagent completion - inject result into parent agent and trigger execution
   * This is called by SpawnSubagentHandler when a subagent finishes
   */
  async onSubagentComplete(
    parentAgentId: string,
    childThreadId: string,
    subagentKey: string,
    result: unknown,
    success: boolean,
  ): Promise<void> {
    const parentAgent = this.state.agents.get(parentAgentId);
    const parentAgentInstance = this.state.agentsCache.get(parentAgentId);

    if (!parentAgent || !parentAgentInstance) {
      console.error(
        '[onSubagentComplete] Parent agent not found:',
        parentAgentId,
      );
      return;
    }

    console.log(
      '[onSubagentComplete] Subagent completed:',
      subagentKey,
      'success:',
      success,
    );

    // Create SUBAGENT_RESULT event
    const resultEvent: BaseEvent = {
      type: EventType.SUBAGENT_RESULT,
      subAgentId: subagentKey,
      childThreadId,
      result,
      success,
      timestamp: Date.now(),
    };

    // Broadcast the result to SSE subscribers
    this.broadcast(parentAgentId, 'subagent:result', {
      subagentKey,
      childThreadId,
      result,
      success,
    });

    // Dispatch the result event into parent agent
    await parentAgent.dispatch(resultEvent);

    // Trigger parent agent to continue execution
    const isStepMode = this.config.isSteppingMode(parentAgentId);
    const executor = this.state.executors.get(parentAgentId);

    if (!isStepMode && executor) {
      console.log(
        '[onSubagentComplete] Triggering parent agent execution:',
        parentAgentId,
      );
      this.broadcast(parentAgentId, 'agent:thinking', { event: resultEvent });
      this.runExecutorAsync(
        parentAgentId,
        executor,
        parentAgentInstance.threadId,
      );
    }
  }

  /**
   * Handle subagent step - broadcast step event to parent agent's SSE subscribers
   * This allows real-time monitoring of subagent progress
   */
  onSubagentStep(
    parentAgentId: string,
    childThreadId: string,
    subagentKey: string,
    event: BaseEvent,
  ): void {
    this.broadcast(parentAgentId, 'subagent:step', {
      subagentKey,
      childThreadId,
      event,
    });
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
