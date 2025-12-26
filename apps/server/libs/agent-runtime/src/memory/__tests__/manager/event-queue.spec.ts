/**
 * Unit tests for EventQueue
 */
import { EventQueue, BlockingReason } from '../../manager/event-queue';
import { EventType, AgentEvent } from '../../types';

describe('EventQueue', () => {
  let queue: EventQueue<string>;

  beforeEach(() => {
    queue = new EventQueue<string>();
  });

  describe('initial state', () => {
    it('should not be blocked initially', () => {
      expect(queue.isBlocked()).toBe(false);
    });

    it('should have no blocking reason initially', () => {
      expect(queue.getBlockingReason()).toBeNull();
    });

    it('should have empty queue initially', () => {
      expect(queue.getQueueLength()).toBe(0);
    });
  });

  describe('blocking', () => {
    it('should block queue with reason', () => {
      queue.block(BlockingReason.COMPACTING);

      expect(queue.isBlocked()).toBe(true);
      expect(queue.getBlockingReason()).toBe(BlockingReason.COMPACTING);
    });

    it('should return unblock function', () => {
      const unblock = queue.block(BlockingReason.PAUSED);

      expect(typeof unblock).toBe('function');
    });

    it('should unblock when unblock function is called', () => {
      const unblock = queue.block(BlockingReason.COMPACTING);

      unblock();

      expect(queue.isBlocked()).toBe(false);
      expect(queue.getBlockingReason()).toBeNull();
    });

    it('should throw error when blocking already blocked queue', () => {
      queue.block(BlockingReason.COMPACTING);

      expect(() => queue.block(BlockingReason.PAUSED)).toThrow(
        'Queue already blocked',
      );
    });
  });

  describe('waitForUnblock', () => {
    it('should resolve immediately when not blocked', async () => {
      await expect(queue.waitForUnblock()).resolves.toBeUndefined();
    });

    it('should wait until unblocked', async () => {
      const unblock = queue.block(BlockingReason.COMPACTING);

      let resolved = false;
      const waitPromise = queue.waitForUnblock().then(() => {
        resolved = true;
      });

      expect(resolved).toBe(false);

      unblock();

      await waitPromise;
      expect(resolved).toBe(true);
    });
  });

  describe('enqueue and dequeue', () => {
    it('should enqueue events', () => {
      const event: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Hello',
      };

      queue.enqueue(event);

      expect(queue.getQueueLength()).toBe(1);
    });

    it('should dequeue events in order', () => {
      const event1: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'First',
      };
      const event2: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Second',
      };

      queue.enqueue(event1);
      queue.enqueue(event2);

      const dequeued1 = queue.dequeue();
      const dequeued2 = queue.dequeue();

      expect(dequeued1?.event).toBe(event1);
      expect(dequeued2?.event).toBe(event2);
    });

    it('should return null when dequeuing empty queue', () => {
      const result = queue.dequeue();

      expect(result).toBeNull();
    });
  });

  describe('processQueue', () => {
    it('should process all queued events', async () => {
      const events: AgentEvent[] = [
        { type: EventType.USER_MESSAGE, timestamp: Date.now(), content: 'A' },
        { type: EventType.USER_MESSAGE, timestamp: Date.now(), content: 'B' },
        { type: EventType.USER_MESSAGE, timestamp: Date.now(), content: 'C' },
      ];

      const promises = events.map((e) => queue.enqueue(e));

      const processed: string[] = [];
      await queue.processQueue(async (event) => {
        const content = (event as { content: string }).content;
        processed.push(content);
        return content;
      });

      expect(processed).toEqual(['A', 'B', 'C']);
      expect(queue.getQueueLength()).toBe(0);

      // Check that enqueue promises resolve with correct values
      const results = await Promise.all(promises);
      expect(results).toEqual(['A', 'B', 'C']);
    });

    it('should reject promise when processor throws', async () => {
      const event: AgentEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Error',
      };

      const promise = queue.enqueue(event);

      await queue.processQueue(async () => {
        throw new Error('Processing failed');
      });

      await expect(promise).rejects.toThrow('Processing failed');
    });
  });

  describe('clear', () => {
    it('should clear all queued events', async () => {
      const events: AgentEvent[] = [
        { type: EventType.USER_MESSAGE, timestamp: Date.now(), content: 'A' },
        { type: EventType.USER_MESSAGE, timestamp: Date.now(), content: 'B' },
      ];

      const promises = events.map((e) => queue.enqueue(e));

      queue.clear(new Error('Queue cleared'));

      expect(queue.getQueueLength()).toBe(0);

      // Check that all promises are rejected
      for (const promise of promises) {
        await expect(promise).rejects.toThrow('Queue cleared');
      }
    });
  });
});
