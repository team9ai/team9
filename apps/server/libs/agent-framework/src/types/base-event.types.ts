/**
 * Base Event Types
 *
 * This file contains only the foundational event infrastructure:
 * - BaseEvent interface for all events
 * - Event dispatch strategies
 * - LLM response requirements
 *
 * This file has NO dependencies on component types to avoid circular imports.
 * Component-specific events import from this file and define their own event types.
 */

// ============ Event Dispatch Strategy ============

/**
 * Strategy for handling event dispatch when agent is processing
 *
 * - QUEUE: (default) Queue the event, process after current operation completes
 * - INTERRUPT: Cancel current generation, immediately process new event
 * - TERMINATE: End the agent's event loop, transition to completed/error state
 * - SILENT: Store only, do not trigger any processing flow (reserved for future use)
 */
export enum EventDispatchStrategy {
  QUEUE = 'queue',
  INTERRUPT = 'interrupt',
  TERMINATE = 'terminate',
  SILENT = 'silent',
}

// ============ LLM Response Requirement ============

/**
 * Requirement for LLM response after processing an event
 *
 * - NEED: LLM should generate a response (e.g., after user message)
 * - NO_NEED: LLM should NOT generate a response (e.g., after task completion)
 * - KEEP: Keep the previous state's value (default for most events)
 */
export enum LLMResponseRequirement {
  NEED = 'need',
  NO_NEED = 'no_need',
  KEEP = 'keep',
}

// ============ Base Event Interface ============

/**
 * Base event interface with generic type parameter
 * Components define their own event types by extending this interface
 *
 * @template T - The event type string
 *
 * @example
 * ```typescript
 * // In your component's types file:
 * export const MyEventType = {
 *   MY_EVENT: 'MY_EVENT',
 * } as const;
 *
 * export interface MyEvent extends BaseEvent<typeof MyEventType.MY_EVENT> {
 *   myData: string;
 * }
 * ```
 */
export interface BaseEvent<T extends string = string> {
  /** Event type */
  type: T;
  /** Timestamp when event occurred */
  timestamp: number;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
  /**
   * Override the default dispatch strategy for this specific event
   * If not specified, uses the default strategy for the event type
   */
  dispatchStrategy?: EventDispatchStrategy;
  /**
   * Requirement for LLM response after processing this event
   * - NEED: LLM should generate a response
   * - NO_NEED: LLM should NOT generate a response
   * - KEEP: Keep the previous state's value (default if not specified)
   */
  llmResponseRequirement?: LLMResponseRequirement;
  /** Allow additional properties for specific event types */
  [key: string]: unknown;
}
