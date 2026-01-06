/**
 * DTO for task registration (API 1: Register Task)
 */
export class RegisterTaskDto {
  /**
   * Optional task ID. If not provided, auto-generates a CUID.
   */
  taskId?: string;

  /**
   * Task type for worker filtering (e.g., 'ai_inference', 'video_encode')
   */
  taskType!: string;

  /**
   * Optional initial metadata for the task (descriptive info)
   */
  metadata?: Record<string, unknown>;

  /**
   * Optional execution parameters passed to worker
   */
  params?: Record<string, unknown>;

  /**
   * Timeout in seconds. Defaults to 86400 (24 hours)
   */
  timeoutSeconds?: number;
}

/**
 * Response for task registration
 */
export interface RegisterTaskResponse {
  taskId: string;
  status: string;
  createdAt: string;
  timeoutAt: string;
}
