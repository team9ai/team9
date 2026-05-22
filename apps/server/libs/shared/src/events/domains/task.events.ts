/**
 * Task WebSocket event type definitions.
 *
 * @module events/domains/task
 */

/**
 * Task updated event.
 *
 * Emitted when task run metadata changes after creation, such as an
 * AI-generated short title replacing the temporary first-line title.
 *
 * @event task_updated
 * @direction Server -> Client
 */
export interface TaskUpdatedEvent {
  /** Task run ID */
  taskId: string;
  /** Updated title, when title changed */
  title?: string;
}
