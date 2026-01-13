import { MemoryThread } from '../types/thread.types.js';
import { MemoryState, StateProvenance } from '../types/state.types.js';
import { MemoryChunk } from '../types/chunk.types.js';
import {
  type BaseEvent,
  EventType,
  EventDispatchStrategy,
  LLMResponseRequirement,
} from '../types/event.types.js';
import { ReducerRegistry, ReducerResult } from '../reducer/reducer.types.js';
import type { ObserverManager } from '../observer/observer.types.js';
import type { CompactionManager } from './compaction.manager.js';
import { generateId, IdPrefix, generateStepId } from '../utils/id.utils.js';
import type { IMemoryManager } from './memory-manager.interface.js';
import type { IStateTransitionManager } from './state-transition.manager.js';
import type { StepLockManager } from './step-lock.manager.js';
import type { StepLifecycleManager } from './step-lifecycle.manager.js';

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
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ProcessEventOptions {
  // Reserved for future use
}

/**
 * Result of compaction check
 */
export enum CompactionCheckResult {
  /** Hard threshold exceeded, must compact before processing */
  FORCE = 'force',
  /** Soft threshold exceeded, compaction recommended */
  SUGGESTION = 'suggestion',
  /** No compaction needed */
  NO = 'no',
}

/**
 * EventProcessor handles the core event processing logic
 * Extracted from MemoryManager for better separation of concerns
 *
 * Note: Compaction is now checked BEFORE processing events by the caller (EventDispatcher/AgentOrchestrator).
 * This ensures we don't add more tokens when already over the hard threshold.
 */
export class EventProcessor {
  constructor(
    private memoryManager: IMemoryManager,
    private stateTransitionManager: IStateTransitionManager,
    private stepLockManager: StepLockManager,
    private stepLifecycleManager: StepLifecycleManager,
    private reducerRegistry: ReducerRegistry,
    private observerManager: ObserverManager,
    private compactionManager: CompactionManager,
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
    event: BaseEvent,
    _options: ProcessEventOptions = {},
  ): Promise<DispatchResult> {
    const startTime = Date.now();

    // Generate a unique event ID for provenance tracking
    const eventId = generateId(IdPrefix.QUEUED_EVENT);

    // Get step ID for provenance tracking
    // In stepping mode, use the current step lock ID
    // In auto mode, generate a new step ID for each event processing
    const existingStepId =
      await this.stepLockManager.getCurrentStepId(threadId);
    const stepId = existingStepId ?? generateStepId();

    // Step 1: Get current state (fetch latest state)
    const currentState = await this.memoryManager.getCurrentState(threadId);
    if (!currentState) {
      throw new Error(`Current state not found for thread: ${threadId}`);
    }

    // Create and save the step record at the start (includes full event payload for debugging)
    await this.stepLifecycleManager.createStep(
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
      // Default to QUEUE if not specified on the event
      const dispatchStrategy =
        event.dispatchStrategy ?? EventDispatchStrategy.QUEUE;

      // Check if this is an interrupt-type event (should cancel current LLM generation)
      const shouldInterrupt =
        dispatchStrategy === EventDispatchStrategy.INTERRUPT;

      // Check if this is a terminate-type event (should end event loop)
      const shouldTerminate =
        dispatchStrategy === EventDispatchStrategy.TERMINATE;

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
        await this.stepLifecycleManager.completeStep(stepId, currentState.id);

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

      // Determine LLM response requirement from event (default to KEEP if not specified)
      const llmResponseRequirement: LLMResponseRequirement =
        event.llmResponseRequirement ?? LLMResponseRequirement.KEEP;

      // Step 4: Apply reducer result through state transition manager with provenance (execute operations -> store new state)
      // The llmResponseRequirement determines whether the new state needs LLM to continue responding
      const result =
        await this.stateTransitionManager.applyReducerResultWithProvenance(
          threadId,
          reducerResult,
          provenance,
          llmResponseRequirement,
        );

      // Complete step with the new state
      await this.stepLifecycleManager.completeStep(stepId, result.state.id);

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
        const spawnEvent = event as unknown as {
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

      // Step 5: Return result with terminate/interrupt flags (is terminate type?)
      return {
        ...result,
        shouldTerminate,
        shouldInterrupt,
        dispatchStrategy,
      };
    } catch (error) {
      // Mark step as failed if an error occurs
      await this.stepLifecycleManager.failStep(
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
    event: BaseEvent,
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
    const thread = await this.memoryManager.getThread(threadId);
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
    triggerEvent: BaseEvent,
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
   * Check if compaction is needed for the current state
   * Called by EventDispatcher/AgentOrchestrator BEFORE processing events
   * to ensure we compact first when over the hard threshold
   *
   * @param state - The current memory state
   * @returns 'force' if hard threshold exceeded, 'suggestion' if soft threshold exceeded, 'no' otherwise
   */
  checkCompactionNeeded(state: Readonly<MemoryState>): CompactionCheckResult {
    const tokenCheck = this.compactionManager.checkTokenUsage(state);

    if (tokenCheck.forceCompaction && tokenCheck.chunksToCompact.length > 0) {
      return CompactionCheckResult.FORCE;
    }

    if (tokenCheck.suggestCompaction && tokenCheck.chunksToCompact.length > 0) {
      return CompactionCheckResult.SUGGESTION;
    }

    return CompactionCheckResult.NO;
  }
}
