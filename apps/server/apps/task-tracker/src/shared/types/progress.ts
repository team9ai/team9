/**
 * Progress update entry with sequence ID for ordering
 */
export interface ProgressEntry {
  seqId: number;
  [key: string]: unknown;
}

/**
 * SSE event types for task tracking
 */
export enum SseEventType {
  /** Individual progress update */
  PROGRESS = 'progress',
  /** Task status changed (completed/failed/timeout) */
  STATUS_CHANGE = 'status_change',
  /** Task completed successfully */
  COMPLETE = 'complete',
  /** Error occurred */
  ERROR = 'error',
}

/**
 * SSE message payload structure
 */
export interface SseMessage {
  event: SseEventType;
  data: unknown;
  taskId: string;
  timestamp: string;
}
