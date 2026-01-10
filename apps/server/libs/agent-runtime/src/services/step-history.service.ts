/**
 * Step History Service
 *
 * Tracks step operations through Observer pattern.
 * Automatically records step history based on memory events.
 */

import { createId } from '@paralleldrive/cuid2';
import type { AgentOrchestrator, MemoryObserver } from '@team9/agent-framework';
import type { StepHistoryEntry } from '../types/index.js';

/**
 * Step History Service manages step history recording for agents
 */
export class StepHistoryService {
  /** Step history per agent */
  private stepHistory = new Map<string, StepHistoryEntry[]>();
  /** Step counter per agent */
  private stepCounters = new Map<string, number>();
  /** Observer cleanup functions */
  private observerCleanups = new Map<string, () => void>();
  /** Last state ID per agent (for tracking state changes) */
  private lastStateIds = new Map<string, string>();

  /**
   * Set up observer for an agent's memory manager
   * Automatically records step history based on events
   */
  setupObserver(agentId: string, memoryManager: AgentOrchestrator): void {
    // Clean up existing observer if any
    this.removeObserver(agentId);

    const observer: MemoryObserver = {
      onStateChange: (info) => {
        // Record state change as a step
        const operationType = this.determineOperationType(info);
        const { type: _type, ...eventWithoutType } = info.triggerEvent ?? {};

        this.recordStep(agentId, {
          timestamp: info.triggerEvent?.timestamp ?? Date.now(),
          operationType,
          processedEvent: info.triggerEvent
            ? { type: info.triggerEvent.type, ...eventWithoutType }
            : undefined,
          llmResponseGenerated: operationType === 'llm_response',
          stateIdBefore: info.previousState.id,
          stateIdAfter: info.newState.id,
        });

        this.lastStateIds.set(agentId, info.newState.id);
      },

      onCompactionEnd: (info) => {
        this.recordStep(agentId, {
          timestamp: info.timestamp,
          operationType: 'compaction',
          llmResponseGenerated: false,
          stateIdBefore: this.lastStateIds.get(agentId) ?? 'unknown',
          stateIdAfter: info.compactedChunkId,
        });
      },

      onError: (info) => {
        // Record error as a step - use 'event' type since 'error' is not a valid operation type
        if (info.threadId) {
          this.recordStep(agentId, {
            timestamp: info.timestamp,
            operationType: 'event',
            llmResponseGenerated: false,
            stateIdBefore: this.lastStateIds.get(agentId) ?? 'unknown',
            stateIdAfter: this.lastStateIds.get(agentId) ?? 'unknown',
            error: info.error.message,
          });
        }
      },
    };

    const cleanup = memoryManager.addObserver(observer);
    this.observerCleanups.set(agentId, cleanup);
  }

  /**
   * Determine operation type from state change info
   */
  private determineOperationType(info: {
    reducerName: string;
    triggerEvent: { type: string } | null;
  }): StepHistoryEntry['operationType'] {
    if (!info.triggerEvent) {
      return 'truncation'; // System operation like truncation
    }

    const eventType = info.triggerEvent.type;

    if (
      eventType === 'LLM_TEXT_RESPONSE' ||
      eventType === 'LLM_TOOL_CALL' ||
      eventType === 'LLM_SKILL_CALL'
    ) {
      return 'llm_response';
    }

    if (eventType.includes('COMPACTION')) {
      return 'compaction';
    }

    return 'event';
  }

  /**
   * Remove observer for an agent
   */
  removeObserver(agentId: string): void {
    const cleanup = this.observerCleanups.get(agentId);
    if (cleanup) {
      cleanup();
      this.observerCleanups.delete(agentId);
    }
  }

  /**
   * Record a step in history
   */
  recordStep(
    agentId: string,
    entry: Omit<StepHistoryEntry, 'id' | 'stepNumber'>,
  ): StepHistoryEntry {
    // Get or initialize step counter
    const stepNumber = (this.stepCounters.get(agentId) ?? 0) + 1;
    this.stepCounters.set(agentId, stepNumber);

    // Create full entry
    const fullEntry: StepHistoryEntry = {
      id: `step_${createId()}`,
      stepNumber,
      ...entry,
    };

    // Get or initialize history
    if (!this.stepHistory.has(agentId)) {
      this.stepHistory.set(agentId, []);
    }
    this.stepHistory.get(agentId)!.push(fullEntry);

    return fullEntry;
  }

  /**
   * Get step history for an agent
   */
  getHistory(agentId: string): StepHistoryEntry[] {
    return this.stepHistory.get(agentId) ?? [];
  }

  /**
   * Clear step history for an agent
   */
  clearHistory(agentId: string): void {
    this.stepHistory.delete(agentId);
    this.stepCounters.delete(agentId);
    this.lastStateIds.delete(agentId);
  }

  /**
   * Clean up all resources for an agent
   */
  cleanup(agentId: string): void {
    this.removeObserver(agentId);
    this.clearHistory(agentId);
  }

  /**
   * Clean up all resources
   */
  cleanupAll(): void {
    for (const cleanup of this.observerCleanups.values()) {
      cleanup();
    }
    this.observerCleanups.clear();
    this.stepHistory.clear();
    this.stepCounters.clear();
    this.lastStateIds.clear();
  }
}

/**
 * Create a step history service instance
 */
export function createStepHistoryService(): StepHistoryService {
  return new StepHistoryService();
}
