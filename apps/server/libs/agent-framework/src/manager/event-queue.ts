import { AgentEvent } from '../types/event.types.js';

/**
 * Queued event with resolution callback
 */
interface QueuedEvent<T> {
  event: AgentEvent;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

/**
 * Blocking reason for the queue
 */
export enum BlockingReason {
  /** Compaction in progress */
  COMPACTING = 'COMPACTING',
  /** Manual pause (for debugging) */
  PAUSED = 'PAUSED',
  /** Stepping mode - events queued until step() is called */
  STEPPING = 'STEPPING',
}

/**
 * Event queue that supports blocking operations
 * When blocked, events are queued and processed once unblocked
 */
export class EventQueue<T> {
  private queue: QueuedEvent<T>[] = [];
  private blockingReason: BlockingReason | null = null;
  private blockingPromise: Promise<void> | null = null;
  private unblockResolve: (() => void) | null = null;

  /**
   * Check if the queue is currently blocked
   */
  isBlocked(): boolean {
    return this.blockingReason !== null;
  }

  /**
   * Get the current blocking reason
   */
  getBlockingReason(): BlockingReason | null {
    return this.blockingReason;
  }

  /**
   * Get the number of queued events
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Block the queue with a reason
   * Returns a function to unblock when the blocking operation completes
   */
  block(reason: BlockingReason): () => void {
    if (this.blockingReason !== null) {
      throw new Error(`Queue already blocked: ${this.blockingReason}`);
    }

    this.blockingReason = reason;
    this.blockingPromise = new Promise<void>((resolve) => {
      this.unblockResolve = resolve;
    });

    return () => this.unblock();
  }

  /**
   * Unblock the queue
   */
  private unblock(): void {
    this.blockingReason = null;
    if (this.unblockResolve) {
      this.unblockResolve();
      this.unblockResolve = null;
    }
    this.blockingPromise = null;
  }

  /**
   * Wait for the queue to be unblocked
   */
  async waitForUnblock(): Promise<void> {
    if (this.blockingPromise) {
      await this.blockingPromise;
    }
  }

  /**
   * Enqueue an event
   * If blocked, the event is queued and will be processed later
   * @returns A promise that resolves when the event is processed
   */
  enqueue(event: AgentEvent): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ event, resolve, reject });
    });
  }

  /**
   * Dequeue an event for processing
   * @returns The next event or null if queue is empty
   */
  dequeue(): QueuedEvent<T> | null {
    return this.queue.shift() ?? null;
  }

  /**
   * Process all queued events with a processor function
   * @param processor - Function to process each event
   */
  async processQueue(
    processor: (event: AgentEvent) => Promise<T>,
  ): Promise<void> {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        try {
          const result = await processor(item.event);
          item.resolve(result);
        } catch (error) {
          item.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    }
  }

  /**
   * Process a single queued event (for stepping mode)
   * @param processor - Function to process the event
   * @returns The result of processing, or null if queue is empty
   */
  async processOne(
    processor: (event: AgentEvent) => Promise<T>,
  ): Promise<T | null> {
    const item = this.queue.shift();
    if (!item) {
      return null;
    }

    try {
      const result = await processor(item.event);
      item.resolve(result);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      item.reject(err);
      throw err;
    }
  }

  /**
   * Peek at the next event without removing it
   * @returns The next event or null if queue is empty
   */
  peek(): AgentEvent | null {
    return this.queue[0]?.event ?? null;
  }

  /**
   * Clear all queued events, rejecting them with an error
   * @param error - The error to reject with
   */
  clear(error: Error): void {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        item.reject(error);
      }
    }
  }
}
