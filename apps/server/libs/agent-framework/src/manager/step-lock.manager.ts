import type { IMemoryManager } from './memory-manager.interface.js';
import { updateThread } from '../factories/thread.factory.js';
import { generateStepId } from '../utils/id.utils.js';

/**
 * StepLockManager handles step lock operations for stepping mode
 * Ensures only one step can be processed at a time per thread
 */
export class StepLockManager {
  constructor(private memoryManager: IMemoryManager) {}

  /**
   * Acquire a step lock for processing
   * If the thread is already locked, throws an error
   * @param threadId - The thread ID
   * @returns The generated step ID
   */
  async acquireStepLock(threadId: string): Promise<string> {
    const thread = await this.memoryManager.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    if (thread.currentStepId) {
      throw new Error(
        `Thread ${threadId} is already processing step ${thread.currentStepId}`,
      );
    }

    const stepId = generateStepId();
    const updatedThread = updateThread(thread, {
      currentStepId: stepId,
    });

    const storage = this.memoryManager.getStorage();
    await storage.updateThread(updatedThread);
    return stepId;
  }

  /**
   * Release the step lock after processing completes
   * @param threadId - The thread ID
   * @param stepId - The step ID to release (must match current lock)
   */
  async releaseStepLock(threadId: string, stepId: string): Promise<void> {
    const thread = await this.memoryManager.getThread(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    if (thread.currentStepId !== stepId) {
      throw new Error(
        `Step lock mismatch: expected ${thread.currentStepId}, got ${stepId}`,
      );
    }

    const updatedThread = updateThread(thread, {
      currentStepId: undefined,
    });

    const storage = this.memoryManager.getStorage();
    await storage.updateThread(updatedThread);
  }

  /**
   * Check if the thread is currently locked for processing
   * @param threadId - The thread ID
   * @returns True if locked, false otherwise
   */
  async isStepLocked(threadId: string): Promise<boolean> {
    const thread = await this.memoryManager.getThread(threadId);
    return thread?.currentStepId !== undefined;
  }

  /**
   * Get the current step ID if locked
   * @param threadId - The thread ID
   * @returns The current step ID or null if not locked
   */
  async getCurrentStepId(threadId: string): Promise<string | null> {
    const thread = await this.memoryManager.getThread(threadId);
    return thread?.currentStepId ?? null;
  }
}
