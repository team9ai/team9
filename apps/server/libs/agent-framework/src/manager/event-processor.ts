import { MemoryThread } from '../types/thread.types.js';
import { MemoryState, StateProvenance } from '../types/state.types.js';
import { MemoryChunk } from '../types/chunk.types.js';
import {
  AgentEvent,
  EventType,
  EventDispatchStrategy,
  LLMResponseRequirement,
  getDefaultDispatchStrategy,
} from '../types/event.types.js';
import { ReducerRegistry, ReducerResult } from '../reducer/reducer.types.js';
import type { ObserverManager } from '../observer/observer.types.js';
import type { CompactionManager } from './compaction.manager.js';
import type { ExecutionModeController } from './execution-mode.controller.js';
import { generateId, IdPrefix, generateStepId } from '../utils/id.utils.js';
import type { Step } from './memory-manager.interface.js';

/**
 * Interface for runtime coordination operations needed by EventProcessor
 * AgentOrchestrator implements this interface
 */
export interface IRuntimeCoordinator {
  // State operations
  getCurrentState(threadId: string): Promise<Readonly<MemoryState> | null>;
  getThread(threadId: string): Promise<Readonly<MemoryThread> | null>;

  // State transitions
  applyReducerResultWithProvenance(
    threadId: string,
    reducerResult: ReducerResult,
    provenance: StateProvenance,
    llmResponseRequirement: LLMResponseRequirement,
  ): Promise<{
    thread: Readonly<MemoryThread>;
    state: Readonly<MemoryState>;
    addedChunks: MemoryChunk[];
    removedChunkIds: string[];
  }>;

  // Step operations
  getCurrentStepId(threadId: string): Promise<string | null>;
  createStep(
    threadId: string,
    stepId: string,
    triggerEvent: { eventId?: string; type: string; timestamp: number },
    previousStateId?: string,
    eventPayload?: AgentEvent,
  ): Promise<Step>;
  completeStep(stepId: string, resultStateId: string): Promise<void>;
  failStep(stepId: string, error: string): Promise<void>;
}

/**
 * Result of dispatching an event
 */
export interface DispatchResult {
  /** The updated thread */
  thread: Readonly<MemoryThread>;
  /** The new state after processing the event */
  state: Readonly<MemoryState>;
  /** Chunks that were added */
  addedChunks: MemoryChunk[];
  /** Chunk IDs that were removed */
  removedChunkIds: string[];
  /**
   * Whether this event should terminate the agent's event loop
   * Set to true for terminate-type events (TASK_COMPLETED, TASK_ABANDONED, TASK_TERMINATED)
   */
  shouldTerminate?: boolean;
  /**
   * Whether this event should interrupt the current LLM generation
   * Set to true for interrupt-type events
   */
  shouldInterrupt?: boolean;
  /**
   * The dispatch strategy that was used for this event
   */
  dispatchStrategy?: EventDispatchStrategy;
}

/**
 * Options for event processing
 */
export interface ProcessEventOptions {
  /** Whether this is stepping mode (doesn't trigger auto-compaction immediately) */
  steppingMode?: boolean;
}

/**
 * EventProcessor handles the core event processing logic
 * Extracted from MemoryManager for better separation of concerns
 */
export class EventProcessor {
  constructor(
    private coordinator: IRuntimeCoordinator,
    private reducerRegistry: ReducerRegistry,
    private observerManager: ObserverManager,
    private compactionManager: CompactionManager,
    private executionModeController: ExecutionModeController,
  ) {}

  /**
   * Process an event and update memory state
   *
   * Flow (based on flow diagram - Event Processor Details):
   * 1. Start -> Fetch latest state
   * 2. Is interrupt type? -> Set shouldInterrupt flag (to cancel current LLM generation)
   * 3. Trigger corresponding reducer -> Execute reducer -> Generate operations
   * 4. Execute operations, get new state -> Store new state
   * 5. Is terminate type? -> Set shouldTerminate flag (to end event loop)
   *
   * @param threadId - The thread ID
   * @param event - The event to process
   * @param options - Processing options
   * @returns The dispatch result with shouldTerminate/shouldInterrupt flags
   */
  async processEvent(
    threadId: string,
    event: AgentEvent,
    options: ProcessEventOptions = {},
  ): Promise<DispatchResult> {
    const { steppingMode = false } = options;
    const startTime = Date.now();

    // Generate a unique event ID for provenance tracking
    const eventId = generateId(IdPrefix.QUEUED_EVENT);

    // Get step ID for provenance tracking
    // In stepping mode, use the current step lock ID
    // In auto mode, generate a new step ID for each event processing
    const existingStepId = await this.coordinator.getCurrentStepId(threadId);
    const stepId = existingStepId ?? generateStepId();

    // Step 1: Get current state (fetch latest state)
    const currentState = await this.coordinator.getCurrentState(threadId);
    if (!currentState) {
      throw new Error(`Current state not found for thread: ${threadId}`);
    }

    // Create and save the step record at the start (includes full event payload for debugging)
    await this.coordinator.createStep(
      threadId,
      stepId,
      {
        eventId,
        type: event.type,
        timestamp: startTime,
      },
      currentState.id,
      event, // Full event payload for debugging
    );

    try {
      // Determine dispatch strategy for this event
      const dispatchStrategy =
        event.dispatchStrategy ?? getDefaultDispatchStrategy(event.type);

      // Check if this is an interrupt-type event (should cancel current LLM generation)
      const shouldInterrupt = dispatchStrategy === 'interrupt';

      // Check if this is a terminate-type event (should end event loop)
      const shouldTerminate = dispatchStrategy === 'terminate';

      // Notify observers of event dispatch
      this.observerManager.notifyEventDispatch({
        threadId,
        event,
        timestamp: startTime,
      });

      // Step 2-3: Run event through reducer registry (execute reducer -> generate operations)
      const reducerResult = await this.executeReducer(
        threadId,
        event,
        currentState,
      );

      // If no operations, return current state unchanged (with strategy flags)
      if (reducerResult.operations.length === 0) {
        // Complete step with current state (no change)
        await this.coordinator.completeStep(stepId, currentState.id);

        const noOpResult = await this.createNoOpResult(threadId, currentState);
        return {
          ...noOpResult,
          shouldTerminate,
          shouldInterrupt,
          dispatchStrategy,
        };
      }

      // Build provenance information for state traceability
      const provenance: StateProvenance = {
        eventId,
        eventType: event.type,
        stepId: stepId ?? undefined,
        source: 'event_dispatch',
        timestamp: startTime,
        context: {
          dispatchStrategy,
          steppingMode,
          // Include subAgentId for LLM_SUBAGENT_SPAWN events
          ...(event.type === EventType.LLM_SUBAGENT_SPAWN && {
            subAgentId: (event as { subAgentId?: string }).subAgentId,
            agentType: (event as { agentType?: string }).agentType,
          }),
          // Include childThreadId for SUBAGENT_RESULT events
          ...(event.type === EventType.SUBAGENT_RESULT && {
            subAgentId: (event as { subAgentId?: string }).subAgentId,
            childThreadId: (event as { childThreadId?: string }).childThreadId,
          }),
        },
      };

      // Determine LLM response requirement from event (default to 'keep' if not specified)
      const llmResponseRequirement: LLMResponseRequirement =
        event.llmResponseRequirement ?? 'keep';

      // Step 4: Apply reducer result through thread manager with provenance (execute operations -> store new state)
      // The llmResponseRequirement determines whether the new state needs LLM to continue responding
      const result = await this.coordinator.applyReducerResultWithProvenance(
        threadId,
        reducerResult,
        provenance,
        llmResponseRequirement,
      );

      // Complete step with the new state
      await this.coordinator.completeStep(stepId, result.state.id);

      // Notify observers of state change
      this.notifyStateChange(
        threadId,
        currentState,
        result.state,
        event,
        reducerResult,
        result.addedChunks,
        result.removedChunkIds,
      );

      // Notify observers of sub-agent spawn if this is a spawn event
      if (event.type === EventType.LLM_SUBAGENT_SPAWN) {
        const spawnEvent = event as {
          subAgentId: string;
          agentType: string;
          task: string;
          timestamp: number;
        };
        this.observerManager.notifySubAgentSpawn({
          parentThreadId: threadId,
          subAgentId: spawnEvent.subAgentId,
          agentType: spawnEvent.agentType,
          task: spawnEvent.task,
          timestamp: spawnEvent.timestamp,
          // Use the NEW state ID (result.state.id) as the parent for visualization
          // The spawn arrow should connect from this new state (which contains the spawn chunk)
          parentStateId: result.state.id,
        });
      }

      // Handle auto-compaction based on mode
      this.handleAutoCompaction(threadId, result.state, steppingMode);

      // Step 5: Return result with terminate/interrupt flags (is terminate type?)
      return {
        ...result,
        shouldTerminate,
        shouldInterrupt,
        dispatchStrategy,
      };
    } catch (error) {
      // Mark step as failed if an error occurs
      await this.coordinator.failStep(
        stepId,
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    }
  }

  /**
   * Execute reducer and notify observers
   */
  private async executeReducer(
    threadId: string,
    event: AgentEvent,
    currentState: Readonly<MemoryState>,
  ): Promise<ReducerResult> {
    const reducerStartTime = Date.now();
    const reducerResult = await this.reducerRegistry.reduce(
      currentState,
      event,
    );
    const reducerDuration = Date.now() - reducerStartTime;

    // Notify observers of reducer execution
    this.observerManager.notifyReducerExecute({
      threadId,
      reducerName: 'ReducerRegistry',
      inputEvent: event,
      inputState: currentState,
      result: reducerResult,
      logs: [],
      duration: reducerDuration,
    });

    return reducerResult;
  }

  /**
   * Create a no-op result when no operations are produced
   */
  private async createNoOpResult(
    threadId: string,
    currentState: Readonly<MemoryState>,
  ): Promise<DispatchResult> {
    const thread = await this.coordinator.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }
    return {
      thread,
      state: currentState,
      addedChunks: [],
      removedChunkIds: [],
    };
  }

  /**
   * Notify observers of state change
   */
  private notifyStateChange(
    threadId: string,
    previousState: Readonly<MemoryState>,
    newState: Readonly<MemoryState>,
    triggerEvent: AgentEvent,
    reducerResult: ReducerResult,
    addedChunks: MemoryChunk[],
    removedChunkIds: string[],
  ): void {
    this.observerManager.notifyStateChange({
      threadId,
      previousState,
      newState,
      triggerEvent,
      reducerName: 'ReducerRegistry',
      operations: reducerResult.operations,
      addedChunks,
      removedChunkIds,
    });
  }

  /**
   * Handle auto-compaction and truncation based on token thresholds
   */
  private handleAutoCompaction(
    threadId: string,
    state: Readonly<MemoryState>,
    steppingMode: boolean,
  ): void {
    const tokenCheck = this.compactionManager.checkTokenUsage(state);

    // Hard threshold (forceCompaction) triggers compaction
    if (tokenCheck.forceCompaction && tokenCheck.chunksToCompact.length > 0) {
      // Set pending compaction for both stepping and auto modes
      // In auto mode, MemoryManager will trigger it in the background
      // In stepping mode, it will be executed on next step
      this.executionModeController.setPendingCompaction(
        threadId,
        tokenCheck.chunksToCompact,
      );
    }

    // Set pending truncation if truncation threshold is exceeded
    if (tokenCheck.needsTruncation && tokenCheck.chunksToTruncate.length > 0) {
      this.executionModeController.setPendingTruncation(
        threadId,
        tokenCheck.chunksToTruncate,
      );
    }
  }

  /**
   * Check if auto-compaction was triggered and consume it
   * Used by MemoryManager to trigger background compaction in auto mode
   */
  consumePendingCompaction(threadId: string): MemoryChunk[] | null {
    return this.executionModeController.consumePendingCompaction(threadId);
  }

  /**
   * Check if truncation was triggered and consume it
   * Used by MemoryManager to trigger background truncation in auto mode
   */
  consumePendingTruncation(threadId: string): string[] | null {
    return this.executionModeController.consumePendingTruncation(threadId);
  }
}
