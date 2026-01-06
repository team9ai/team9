/**
 * Redis key prefix for task tracker namespace isolation
 */
export const TRACKER_PREFIX = 'team9:tracker:';

/**
 * Redis key generators for task tracker
 */
export const RedisKeys = {
  /**
   * Progress history array for a task (stored as JSON array in Redis)
   * @param taskId - Task identifier
   */
  taskProgress: (taskId: string) => `${TRACKER_PREFIX}progress:${taskId}`,

  /**
   * Sequence counter for progress updates within a task
   * @param taskId - Task identifier
   */
  taskSeqId: (taskId: string) => `${TRACKER_PREFIX}seq:${taskId}`,

  /**
   * Set of active SSE subscribers for a task
   * @param taskId - Task identifier
   */
  taskSubscribers: (taskId: string) => `${TRACKER_PREFIX}subs:${taskId}`,
} as const;
