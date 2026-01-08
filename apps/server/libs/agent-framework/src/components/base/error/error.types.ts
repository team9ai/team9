/**
 * Error Component Types
 * Type definitions for error handling
 */

/**
 * Error severity levels
 */
export type ErrorSeverity = 'warning' | 'error' | 'critical';

/**
 * Error entry stored in component data
 */
export interface ErrorEntry {
  id: string;
  type: 'tool' | 'skill' | 'subagent' | 'system';
  severity: ErrorSeverity;
  message: string;
  details?: unknown;
  timestamp: number;
}
