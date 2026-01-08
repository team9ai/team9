/**
 * System Instructions Component Types
 */

/**
 * Configuration for SystemInstructionsComponent
 */
export interface SystemInstructionsComponentConfig {
  /** Main system instructions */
  instructions: string;
  /** Additional context sections */
  context?: Record<string, string>;
  /** Template variables for interpolation */
  variables?: Record<string, unknown>;
  /** Render order (default: 50, lower = earlier in system prompt) */
  order?: number;
}
