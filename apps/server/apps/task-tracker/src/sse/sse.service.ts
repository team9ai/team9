import { Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
import { SseEventType, type SseMessage } from '../shared/types/index.js';

/**
 * SSE (Server-Sent Events) service for managing task progress subscriptions.
 * Maintains in-memory subjects for broadcasting progress updates to connected clients.
 */
@Injectable()
export class SseService {
  private readonly logger = new Logger(SseService.name);

  /**
   * Map of taskId -> Subject for broadcasting events to subscribers
   */
  private readonly taskSubjects = new Map<string, Subject<MessageEvent>>();

  /**
   * Map of taskId -> subscriber count for cleanup tracking
   */
  private readonly subscriberCounts = new Map<string, number>();

  /**
   * Get or create a subject for a task
   */
  getTaskSubject(taskId: string): Subject<MessageEvent> {
    let subject = this.taskSubjects.get(taskId);
    if (!subject) {
      subject = new Subject<MessageEvent>();
      this.taskSubjects.set(taskId, subject);
      this.subscriberCounts.set(taskId, 0);
      this.logger.debug(`Created subject for task ${taskId}`);
    }
    return subject;
  }

  /**
   * Register a new subscriber for a task
   */
  addSubscriber(taskId: string): void {
    const count = this.subscriberCounts.get(taskId) ?? 0;
    this.subscriberCounts.set(taskId, count + 1);
    this.logger.debug(
      `Added subscriber for task ${taskId}, total: ${count + 1}`,
    );
  }

  /**
   * Unregister a subscriber for a task
   */
  removeSubscriber(taskId: string): void {
    const count = this.subscriberCounts.get(taskId) ?? 0;
    if (count > 0) {
      this.subscriberCounts.set(taskId, count - 1);
      this.logger.debug(
        `Removed subscriber for task ${taskId}, remaining: ${count - 1}`,
      );

      // Cleanup subject if no more subscribers
      if (count - 1 === 0) {
        this.cleanupTask(taskId);
      }
    }
  }

  /**
   * Broadcast a progress update to all subscribers of a task
   */
  broadcastProgress(taskId: string, progress: Record<string, unknown>): void {
    const subject = this.taskSubjects.get(taskId);
    if (subject) {
      const message: SseMessage = {
        event: SseEventType.PROGRESS,
        data: progress,
        taskId,
        timestamp: new Date().toISOString(),
      };
      subject.next({ data: message } as MessageEvent);
      this.logger.debug(`Broadcast progress for task ${taskId}`);
    }
  }

  /**
   * Broadcast a status change to all subscribers and complete the stream
   */
  broadcastStatusChange(
    taskId: string,
    status: string,
    result?: Record<string, unknown>,
    error?: Record<string, unknown>,
  ): void {
    const subject = this.taskSubjects.get(taskId);
    if (subject) {
      const message: SseMessage = {
        event: SseEventType.STATUS_CHANGE,
        data: { status, result, error },
        taskId,
        timestamp: new Date().toISOString(),
      };
      subject.next({ data: message } as MessageEvent);
      this.logger.debug(
        `Broadcast status change for task ${taskId}: ${status}`,
      );

      // Complete the stream for terminal states
      if (
        status === 'completed' ||
        status === 'failed' ||
        status === 'timeout'
      ) {
        subject.complete();
        this.cleanupTask(taskId);
      }
    }
  }

  /**
   * Check if a task has active subscribers
   */
  hasSubscribers(taskId: string): boolean {
    return (this.subscriberCounts.get(taskId) ?? 0) > 0;
  }

  /**
   * Cleanup task subject and subscriber count
   */
  private cleanupTask(taskId: string): void {
    const subject = this.taskSubjects.get(taskId);
    if (subject && !subject.closed) {
      subject.complete();
    }
    this.taskSubjects.delete(taskId);
    this.subscriberCounts.delete(taskId);
    this.logger.debug(`Cleaned up subject for task ${taskId}`);
  }
}
