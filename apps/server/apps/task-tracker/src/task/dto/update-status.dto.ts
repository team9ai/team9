import type { TaskStatus } from '@team9/database';

/**
 * DTO for updating task status to in_progress (API 2: Claim task manually)
 */
export class StartTaskDto {
  /**
   * Worker ID claiming this task
   */
  workerId!: string;
}

/**
 * DTO for completing a task (API 2: Complete task)
 */
export class CompleteTaskDto {
  /**
   * Worker ID that completed this task
   */
  workerId!: string;

  /**
   * Result data from task execution
   */
  result!: Record<string, unknown>;
}

/**
 * DTO for failing a task (API 2: Fail task)
 */
export class FailTaskDto {
  /**
   * Worker ID that failed this task
   */
  workerId!: string;

  /**
   * Error information
   */
  error!: Record<string, unknown>;
}

/**
 * DTO for manually timing out a task (API 2: Manual timeout)
 */
export class TimeoutTaskDto {
  /**
   * Worker ID triggering the timeout
   */
  workerId?: string;
}

/**
 * Response for status update operations
 */
export interface UpdateStatusResponse {
  taskId: string;
  status: TaskStatus;
  updatedAt: string;
}
