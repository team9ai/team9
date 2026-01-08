/**
 * SubAgent Component Types
 */

/**
 * Sub-agent tracking info
 */
export interface SubAgentInfo {
  id: string;
  type: string;
  task: string;
  status: 'spawning' | 'running' | 'completed' | 'failed';
  childThreadId?: string;
  spawnedAt: number;
  completedAt?: number;
  result?: unknown;
  error?: string;
}
