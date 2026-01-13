/**
 * Agent - User-friendly wrapper for agent instances
 *
 * Provides a simplified API for interacting with an agent thread.
 * Hides internal implementation details like AgentOrchestrator.
 */

import type { AgentOrchestrator } from '../manager/agent-orchestrator.js';
import type { MemoryState } from '../types/state.types.js';
import type { MemoryThread, QueuedEvent } from '../types/thread.types.js';
import type { BaseEvent } from '../types/event.types.js';
import type { MemoryObserver } from '../observer/observer.types.js';
import type { ExecutionMode } from '../blueprint/blueprint.types.js';
import type { DispatchResult } from '../manager/event-processor.js';
import type { StepResult } from '../manager/execution-mode.controller.js';
import type { Step } from '../manager/memory-manager.interface.js';
import type { Tool } from '../tools/tool.types.js';
import type { IComponent } from '../components/component.interface.js';

/**
 * Agent instance wrapper
 *
 * Represents a running agent with a specific threadId.
 * Provides methods for event dispatch, state queries, and execution control.
 */
export class Agent {
  /**
   * Create an Agent wrapper
   * @internal Use AgentFactory.createAgent() or AgentFactory.restoreAgent() instead
   */
  constructor(
    private readonly orchestrator: AgentOrchestrator,
    public readonly threadId: string,
    public readonly blueprintName?: string,
    public readonly tools: Tool[] = [],
    public readonly components: IComponent[] = [],
  ) {}

  // ============ Core Operations ============

  /**
   * Dispatch an event to this agent
   * @param event - The event to dispatch
   * @returns The dispatch result with updated state
   */
  async dispatch(event: BaseEvent): Promise<DispatchResult> {
    return this.orchestrator.dispatch(this.threadId, event);
  }

  /**
   * Execute a single step manually in stepping mode
   * @returns The step result
   * @throws Error if not in stepping mode
   */
  async manualStep(): Promise<StepResult> {
    return this.orchestrator.manualStep(this.threadId);
  }

  // ============ State Queries ============

  /**
   * Get the current memory state
   * @returns The current state or null if not found
   */
  async getState(): Promise<MemoryState | null> {
    const state = await this.orchestrator.getCurrentState(this.threadId);
    return state ? { ...state } : null;
  }

  /**
   * Get the thread metadata
   * @returns The thread or null if not found
   */
  async getThread(): Promise<MemoryThread | null> {
    const thread = await this.orchestrator.getThread(this.threadId);
    return thread ? { ...thread } : null;
  }

  // ============ Execution Mode ============

  /**
   * Get the current execution mode
   * @returns 'auto' or 'stepping'
   */
  getExecutionMode(): ExecutionMode {
    return this.orchestrator.getExecutionMode(this.threadId);
  }

  /**
   * Set the execution mode
   * When switching from 'stepping' to 'auto', queued events are processed
   * @param mode - The new execution mode
   */
  async setExecutionMode(mode: ExecutionMode): Promise<void> {
    return this.orchestrator.setExecutionMode(this.threadId, mode);
  }

  // ============ Observers ============

  /**
   * Add an observer to receive memory events
   * @param observer - The observer to add
   * @returns A function to remove the observer
   */
  addObserver(observer: MemoryObserver): () => void {
    return this.orchestrator.addObserver(observer);
  }

  /**
   * Remove an observer
   * @param observer - The observer to remove
   */
  removeObserver(observer: MemoryObserver): void {
    this.orchestrator.removeObserver(observer);
  }

  // ============ Advanced Operations ============

  /**
   * Trigger compaction for the thread's working history
   * @returns The dispatch result after compaction
   */
  async triggerCompaction(): Promise<DispatchResult> {
    return this.orchestrator.triggerCompaction(this.threadId);
  }

  // ============ Event Queue ============

  /**
   * Get pending events in the queue
   * @returns Array of queued events
   */
  async getPendingEvents(): Promise<QueuedEvent[]> {
    return this.orchestrator.getPersistentEventQueue(this.threadId);
  }

  /**
   * Get the count of pending events in the queue
   * @returns Number of events in queue
   */
  async getPendingEventsCount(): Promise<number> {
    return this.orchestrator.getPersistentQueueLength(this.threadId);
  }

  // ============ Step Operations ============

  /**
   * Get all steps for this thread
   * @returns Array of steps ordered by start time
   */
  async getSteps(): Promise<Step[]> {
    return this.orchestrator.getStepsByThread(this.threadId);
  }

  /**
   * Get a specific step by ID
   * @param stepId - The step ID
   * @returns The step or null if not found
   */
  async getStep(stepId: string): Promise<Step | null> {
    return this.orchestrator.getStep(stepId);
  }

  // ============ State History ============

  /**
   * Get the state history for this thread
   * @returns Array of states in chronological order
   */
  async getStateHistory(): Promise<readonly MemoryState[]> {
    return this.orchestrator.getStateHistory(this.threadId);
  }

  // ============ Advanced Access ============

  /**
   * Get the underlying orchestrator for advanced operations
   *
   * Use this for debug-level operations like:
   * - isStepLocked(), hasPendingCompaction(), hasPendingTruncation()
   * - peekPersistentEvent()
   * - Fork, edit, snapshot operations via debug utilities
   * - LLMLoopExecutor creation in AgentExecutor
   *
   * @returns The AgentOrchestrator instance
   */
  getOrchestrator(): AgentOrchestrator {
    return this.orchestrator;
  }
}
