/**
 * SSE Broadcaster Service
 *
 * Handles Server-Sent Events broadcasting for agent events.
 * Separates SSE subscription/broadcast logic from AgentService.
 */

import type { MemoryManager, MemoryObserver } from '@team9/agent-framework';
import type { SSEMessage, SSEEventType } from '../types/index.js';

/**
 * Subscriber callback for SSE events
 */
export type SSESubscriber = (message: SSEMessage) => void;

/**
 * SSE Broadcaster manages subscriptions and broadcasts for agent events
 */
export class SSEBroadcaster {
  private subscribers = new Map<string, Set<SSESubscriber>>();
  private observerCleanups = new Map<string, () => void>();

  /**
   * Set up observer for an agent's memory manager
   * Automatically broadcasts events to SSE subscribers
   */
  setupObserver(agentId: string, memoryManager: MemoryManager): void {
    // Clean up existing observer if any
    this.removeObserver(agentId);

    const observer: MemoryObserver = {
      onEventDispatch: (event) => {
        this.broadcast(agentId, 'event:dispatch', event);
      },
      onReducerExecute: (event) => {
        this.broadcast(agentId, 'reducer:execute', event);
      },
      onStateChange: (event) => {
        this.broadcast(agentId, 'state:change', event);
      },
      onSubAgentSpawn: (event) => {
        this.broadcast(agentId, 'subagent:spawn', event);
      },
      onSubAgentResult: (event) => {
        this.broadcast(agentId, 'subagent:result', event);
      },
      onCompactionStart: (event) => {
        this.broadcast(agentId, 'compaction:start', event);
      },
      onCompactionEnd: (event) => {
        this.broadcast(agentId, 'compaction:end', event);
      },
      onError: (event) => {
        this.broadcast(agentId, 'error', event);
      },
    };

    const cleanup = memoryManager.addObserver(observer);
    this.observerCleanups.set(agentId, cleanup);
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
   * Subscribe to agent SSE events
   * @returns Unsubscribe function
   */
  subscribe(agentId: string, callback: SSESubscriber): () => void {
    if (!this.subscribers.has(agentId)) {
      this.subscribers.set(agentId, new Set());
    }

    const agentSubscribers = this.subscribers.get(agentId)!;
    agentSubscribers.add(callback);

    return () => {
      agentSubscribers.delete(callback);
      if (agentSubscribers.size === 0) {
        this.subscribers.delete(agentId);
      }
    };
  }

  /**
   * Broadcast SSE message to all subscribers of an agent
   */
  broadcast(agentId: string, type: SSEEventType, data: unknown): void {
    const agentSubscribers = this.subscribers.get(agentId);
    if (!agentSubscribers) return;

    const message: SSEMessage = {
      type,
      data,
      timestamp: Date.now(),
    };

    agentSubscribers.forEach((subscriber) => {
      try {
        subscriber(message);
      } catch (error) {
        console.error(
          '[SSEBroadcaster] Error broadcasting to subscriber:',
          error,
        );
      }
    });
  }

  /**
   * Check if an agent has any subscribers
   */
  hasSubscribers(agentId: string): boolean {
    const agentSubscribers = this.subscribers.get(agentId);
    return agentSubscribers ? agentSubscribers.size > 0 : false;
  }

  /**
   * Get subscriber count for an agent
   */
  getSubscriberCount(agentId: string): number {
    return this.subscribers.get(agentId)?.size ?? 0;
  }

  /**
   * Clean up all resources for an agent
   */
  cleanup(agentId: string): void {
    this.removeObserver(agentId);
    this.subscribers.delete(agentId);
  }

  /**
   * Clean up all resources
   */
  cleanupAll(): void {
    for (const cleanup of this.observerCleanups.values()) {
      cleanup();
    }
    this.observerCleanups.clear();
    this.subscribers.clear();
  }
}

/**
 * Create an SSE broadcaster instance
 */
export function createSSEBroadcaster(): SSEBroadcaster {
  return new SSEBroadcaster();
}
