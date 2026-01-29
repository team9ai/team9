/**
 * Response for task retry (API 9: Retry Task)
 */
export interface RetryTaskResponse {
  newTaskId: string;
  originalTaskId: string;
  status: string;
  retryCount: number;
}
