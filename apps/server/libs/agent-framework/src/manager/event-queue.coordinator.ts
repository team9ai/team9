import type { QueuedEvent } from '../types/thread.types.js';
import type { BaseEvent } from '../types/event.types.js';
import type { IMemoryManager } from './memory-manager.interface.js';
import type { ObserverManager } from '../observer/observer.types.js';
import { generateQueuedEventId } from '../utils/id.utils.js';

/**
 * EventQueueCoordinator handles persistent event queue operations
 * with observer notifications
 */
export class EventQueueCoordinator {
  constructor(
    private memoryManager: IMemoryManager,
    private observerManager: ObserverManager,
  ) {}

  /**
   * Get the persistent event queue for a thread
   * This queue is persisted to storage and survives restarts
   */
  async getPersistentEventQueue(threadId: string): Promise<QueuedEvent[]> {
    const eventQueue = this.memoryManager.getEventQueue(threadId);
    return eventQueue.getAll();
  }

  /**
   * Push an event to the persistent queue
   * Notifies observers of the queue change
   */
  async pushEventToQueue(
    threadId: string,
    event: BaseEvent,
  ): Promise<QueuedEvent> {
    const queuedEvent: QueuedEvent = {
      id: generateQueuedEventId(),
      event,
      queuedAt: Date.now(),
    };

    const eventQueue = this.memoryManager.getEventQueue(threadId);
    await eventQueue.push(queuedEvent);
    const queueLength = await eventQueue.length();

    // Notify observers
    this.observerManager.notifyEventQueued({
      threadId,
      queuedEvent,
      queueLength,
      timestamp: Date.now(),
    });

    return queuedEvent;
  }

  /**
   * Pop the first event from the persistent queue
   * Notifies observers of the queue change
   */
  async popEventFromQueue(threadId: string): Promise<QueuedEvent | null> {
    const eventQueue = this.memoryManager.getEventQueue(threadId);
    const queuedEvent = await eventQueue.pop();
    if (!queuedEvent) {
      return null;
    }

    const queueLength = await eventQueue.length();

    // Notify observers
    this.observerManager.notifyEventDequeued({
      threadId,
      queuedEvent,
      queueLength,
      timestamp: Date.now(),
    });

    return queuedEvent;
  }

  /**
   * Peek at the first event in the persistent queue without removing it
   */
  async peekPersistentEvent(threadId: string): Promise<QueuedEvent | null> {
    const eventQueue = this.memoryManager.getEventQueue(threadId);
    return eventQueue.peek();
  }

  /**
   * Get the number of events in the persistent queue
   */
  async getPersistentQueueLength(threadId: string): Promise<number> {
    const eventQueue = this.memoryManager.getEventQueue(threadId);
    return eventQueue.length();
  }

  /**
   * Clear all events from the persistent queue
   */
  async clearPersistentQueue(threadId: string): Promise<void> {
    const eventQueue = this.memoryManager.getEventQueue(threadId);
    return eventQueue.clear();
  }
}
