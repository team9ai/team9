import type { IMemoryManager, Step } from './memory-manager.interface.js';
import type { AgentEvent } from '../types/event.types.js';

/**
 * StepLifecycleManager handles step lifecycle operations
 * Creates, completes, and fails steps
 */
export class StepLifecycleManager {
  constructor(private memoryManager: IMemoryManager) {}

  // ============ LLM Response Check ============

  /**
   * Check if the thread needs LLM to continue responding
   * This is determined by the event's llmResponseRequirement during state transition
   * @param threadId - The thread ID
   * @returns True if LLM should continue responding, false otherwise
   */
  async needLLMContinueResponse(threadId: string): Promise<boolean> {
    const state = await this.memoryManager.getCurrentState(threadId);
    return state?.needLLMContinueResponse ?? false;
  }

  // ============ Step Lifecycle ============

  /**
   * Create and save a new step record
   * @param threadId - The thread ID
   * @param stepId - The step ID
   * @param triggerEvent - The event that triggered this step
   * @param previousStateId - The state ID before this step
   * @param eventPayload - The full event payload for debugging
   * @returns The created step
   */
  async createStep(
    threadId: string,
    stepId: string,
    triggerEvent: { eventId?: string; type: string; timestamp: number },
    previousStateId?: string,
    eventPayload?: AgentEvent,
  ): Promise<Step> {
    const step: Step = {
      id: stepId,
      threadId,
      triggerEvent,
      eventPayload,
      status: 'running',
      startedAt: Date.now(),
      previousStateId,
    };

    const storage = this.memoryManager.getStorage();
    await storage.saveStep(step);
    return step;
  }

  /**
   * Complete a step successfully
   * @param stepId - The step ID
   * @param resultStateId - The resulting state ID
   */
  async completeStep(stepId: string, resultStateId: string): Promise<void> {
    const step = await this.memoryManager.getStep(stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    const completedAt = Date.now();
    const updatedStep: Step = {
      ...step,
      status: 'completed',
      completedAt,
      duration: completedAt - step.startedAt,
      resultStateId,
    };

    const storage = this.memoryManager.getStorage();
    await storage.updateStep(updatedStep);
  }

  /**
   * Mark a step as failed
   * @param stepId - The step ID
   * @param error - The error message
   */
  async failStep(stepId: string, error: string): Promise<void> {
    const step = await this.memoryManager.getStep(stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }

    const completedAt = Date.now();
    const updatedStep: Step = {
      ...step,
      status: 'failed',
      completedAt,
      duration: completedAt - step.startedAt,
      error,
    };

    const storage = this.memoryManager.getStorage();
    await storage.updateStep(updatedStep);
  }
}
