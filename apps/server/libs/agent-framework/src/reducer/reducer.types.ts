import { MemoryState } from '../types/state.types';
import { MemoryChunk } from '../types/chunk.types';
import { Operation } from '../types/operation.types';
import { AgentEvent, EventType } from '../types/event.types';

/**
 * Result of a reducer processing
 * Contains operations to apply and any new chunks that need to be created
 */
export interface ReducerResult {
  /** Operations to be applied to the state */
  operations: Operation[];
  /** New chunks that will be referenced by the operations */
  chunks: MemoryChunk[];
}

/**
 * Base event reducer interface
 * Reducers process events and generate operations to modify state
 */
export interface EventReducer<TEvent extends AgentEvent = AgentEvent> {
  /** Event types this reducer handles */
  readonly eventTypes: EventType[];

  /**
   * Check if this reducer can handle the given event
   * @param event - The event to check
   * @returns Whether this reducer can handle the event
   */
  canHandle(event: AgentEvent): event is TEvent;

  /**
   * Process an event and generate operations
   * @param state - The current memory state
   * @param event - The event to process
   * @returns The operations and chunks to apply
   */
  reduce(
    state: MemoryState,
    event: TEvent,
  ): ReducerResult | Promise<ReducerResult>;
}

/**
 * Reducer registry for managing multiple reducers
 */
export interface ReducerRegistry {
  /**
   * Register a reducer
   * @param reducer - The reducer to register
   */
  register(reducer: EventReducer): void;

  /**
   * Unregister a reducer
   * @param reducer - The reducer to unregister
   */
  unregister(reducer: EventReducer): void;

  /**
   * Get reducers that can handle the given event
   * @param event - The event to find reducers for
   * @returns Array of reducers that can handle the event
   */
  getReducersForEvent(event: AgentEvent): EventReducer[];

  /**
   * Process an event through all applicable reducers
   * @param state - The current memory state
   * @param event - The event to process
   * @returns Combined result from all applicable reducers
   */
  reduce(state: MemoryState, event: AgentEvent): Promise<ReducerResult>;
}

/**
 * Reducer middleware function type
 * Can intercept and modify reducer behavior
 */
export type ReducerMiddleware = (
  state: MemoryState,
  event: AgentEvent,
  next: (
    state: MemoryState,
    event: AgentEvent,
  ) => ReducerResult | Promise<ReducerResult>,
) => ReducerResult | Promise<ReducerResult>;

// ============ Legacy Support ============

/**
 * @deprecated Use EventReducer instead
 * Base reducer interface (legacy)
 * Reducers process inputs and generate operations to modify state
 */
export interface Reducer<TInput = unknown> {
  /**
   * Process an input and generate operations
   * @param state - The current memory state
   * @param input - The input to process
   * @returns The operations and chunks to apply
   */
  reduce(
    state: MemoryState,
    input: TInput,
  ): ReducerResult | Promise<ReducerResult>;
}

/**
 * @deprecated Use ReducerRegistry instead
 * Composed reducer that combines multiple reducers
 */
export interface ComposedReducer<TInput = unknown> extends Reducer<TInput> {
  /**
   * Add a reducer to the composition
   * @param reducer - The reducer to add
   */
  use(reducer: Reducer<TInput>): void;
}
