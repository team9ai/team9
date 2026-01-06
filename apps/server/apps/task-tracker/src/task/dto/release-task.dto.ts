/**
 * DTO for releasing a task (API 8: Release Task)
 */
export class ReleaseTaskDto {
  /**
   * Worker ID releasing the task - must match the current worker
   */
  workerId!: string;
}

/**
 * Response for task release
 */
export interface ReleaseTaskResponse {
  taskId: string;
  status: string;
  message: string;
}
