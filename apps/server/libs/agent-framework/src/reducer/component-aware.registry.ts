/**
 * ComponentAwareReducerRegistry - Routes events to Components based on supportedEventTypes
 *
 * This registry implements the Component-Centric event architecture:
 * 1. Check if any registered component handles this event type via supportedEventTypes
 * 2. If yes, route to component's getReducersForEvent() and execute with ComponentContext
 * 3. If no, fall back to core reducers (DefaultReducerRegistry style)
 *
 * This allows components to define and handle their own events while
 * maintaining backward compatibility with existing core reducers.
 */

import type { MemoryState } from '../types/state.types.js';
import type { BaseEvent } from '../types/event.types.js';
import type {
  IComponent,
  ComponentContext,
} from '../components/component.interface.js';
import type {
  EventReducer,
  ReducerRegistry,
  ReducerResult,
} from './reducer.types.js';

/**
 * Interface for providing component instances and contexts
 */
export interface IComponentProvider {
  /**
   * Get all active component instances
   */
  getActiveComponents(): IComponent[];

  /**
   * Get a component context for executing reducers
   * @param threadId - The thread ID
   * @param componentKey - The component key (component.id)
   * @param state - Current memory state
   */
  getComponentContext(
    threadId: string,
    componentKey: string,
    state: MemoryState,
  ): ComponentContext;
}

/**
 * ComponentAwareReducerRegistry routes events to components or core reducers
 *
 * Architecture:
 * - Events matching component's supportedEventTypes → Component's getReducersForEvent()
 * - Events not handled by any component → Core reducers (fallback)
 */
export class ComponentAwareReducerRegistry implements ReducerRegistry {
  private coreReducers: EventReducer[] = [];
  private componentProvider: IComponentProvider | null = null;

  // Cache for event type to component mapping (cleared when provider changes)
  private eventTypeToComponent = new Map<string, IComponent>();

  constructor(coreReducers?: EventReducer[]) {
    if (coreReducers) {
      this.coreReducers = [...coreReducers];
    }
  }

  /**
   * Set the component provider for event routing
   * Must be called before processing events
   */
  setComponentProvider(provider: IComponentProvider): void {
    this.componentProvider = provider;
    this.eventTypeToComponent.clear();
  }

  /**
   * Register a core reducer (fallback for events not handled by components)
   */
  register(reducer: EventReducer): void {
    if (!this.coreReducers.includes(reducer)) {
      this.coreReducers.push(reducer);
    }
  }

  /**
   * Unregister a core reducer
   */
  unregister(reducer: EventReducer): void {
    const index = this.coreReducers.indexOf(reducer);
    if (index !== -1) {
      this.coreReducers.splice(index, 1);
    }
  }

  /**
   * Get reducers for an event (for compatibility, returns core reducers only)
   */
  getReducersForEvent(event: BaseEvent): EventReducer[] {
    return this.coreReducers.filter((r) => r.canHandle(event));
  }

  /**
   * Process an event through component reducers or core reducers
   *
   * Flow:
   * 1. Find component that handles this event type (via supportedEventTypes)
   * 2. If found, get ComponentContext and execute component's reducers
   * 3. If not found, use core reducers
   */
  async reduce(state: MemoryState, event: BaseEvent): Promise<ReducerResult> {
    // Try to find a component that handles this event
    const component = this.findComponentForEvent(event.type);

    if (component && this.componentProvider && state.threadId) {
      // Get reducers from component
      const componentReducers = component.getReducersForEvent(event);

      if (componentReducers.length > 0) {
        // Get component context
        const context = this.componentProvider.getComponentContext(
          state.threadId,
          component.id,
          state,
        );

        // Execute component reducers
        const allOperations: ReducerResult['operations'] = [];
        const allChunks: ReducerResult['chunks'] = [];

        for (const reducerFn of componentReducers) {
          const result = await reducerFn(state, event, context);
          allOperations.push(...result.operations);
          allChunks.push(...result.chunks);
        }

        return { operations: allOperations, chunks: allChunks };
      }
    }

    // Fall back to core reducers
    return this.reduceCoreEvent(state, event);
  }

  /**
   * Find a component that handles the given event type
   */
  private findComponentForEvent(eventType: string): IComponent | undefined {
    // Check cache first
    if (this.eventTypeToComponent.has(eventType)) {
      return this.eventTypeToComponent.get(eventType);
    }

    if (!this.componentProvider) {
      return undefined;
    }

    // Search through active components
    const components = this.componentProvider.getActiveComponents();
    for (const component of components) {
      if (component.supportedEventTypes?.includes(eventType)) {
        this.eventTypeToComponent.set(eventType, component);
        return component;
      }
    }

    return undefined;
  }

  /**
   * Process event through core reducers
   */
  private async reduceCoreEvent(
    state: MemoryState,
    event: BaseEvent,
  ): Promise<ReducerResult> {
    const applicableReducers = this.coreReducers.filter((r) =>
      r.canHandle(event),
    );

    if (applicableReducers.length === 0) {
      return { operations: [], chunks: [] };
    }

    const allOperations: ReducerResult['operations'] = [];
    const allChunks: ReducerResult['chunks'] = [];

    for (const reducer of applicableReducers) {
      const result = await reducer.reduce(state, event);
      allOperations.push(...result.operations);
      allChunks.push(...result.chunks);
    }

    return { operations: allOperations, chunks: allChunks };
  }

  /**
   * Clear the event type to component cache
   * Call this when components are added/removed
   */
  clearCache(): void {
    this.eventTypeToComponent.clear();
  }

  /**
   * Get all registered core reducers
   */
  getCoreReducers(): readonly EventReducer[] {
    return this.coreReducers;
  }
}
