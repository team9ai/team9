/**
 * DTO for updating task progress (API 4: Update Progress)
 */
export class UpdateProgressDto {
  /**
   * Progress update data. seqId will be auto-added if not provided.
   */
  progress!: Record<string, unknown>;
}

/**
 * Response for progress update
 */
export interface UpdateProgressResponse {
  taskId: string;
  seqId: number;
  timestamp: string;
}
