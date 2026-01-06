import type { Task } from '@team9/database';

/**
 * DTO for claiming a task (API 7: Claim Task)
 */
export class ClaimTaskDto {
  /**
   * Task types this worker can handle
   */
  taskTypes!: string[];

  /**
   * Worker ID claiming the task
   */
  workerId!: string;
}

/**
 * Response for task claim - returns the claimed task or null
 */
export type ClaimTaskResponse = Task | null;
