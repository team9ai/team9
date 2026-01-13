/**
 * ThreadComponentProvider - Provides component instances per thread
 *
 * This provider stores component instances for each thread and provides
 * ComponentContext for reducer execution. It implements IComponentProvider
 * for use with ComponentAwareReducerRegistry.
 */

import type { MemoryState } from '../types/state.types.js';
import type {
  IComponent,
  ComponentContext,
  ComponentRuntimeState,
} from './component.interface.js';
import type { IComponentProvider } from '../reducer/component-aware.registry.js';
import { createComponentContext } from './component-context.js';

/**
 * Internal storage for thread-specific component data
 */
interface ThreadComponentData {
  /** Component instances for this thread */
  components: IComponent[];
  /** Per-component data storage (componentKey -> key -> value) */
  componentData: Map<string, Map<string, unknown>>;
}

/**
 * ThreadComponentProvider manages component instances per thread
 *
 * Usage:
 * 1. Create provider and set on ComponentAwareReducerRegistry
 * 2. Register component instances when agents are created
 * 3. Registry queries provider for components and contexts during reduce()
 */
export class ThreadComponentProvider implements IComponentProvider {
  private threads = new Map<string, ThreadComponentData>();

  /**
   * Register component instances for a thread
   * Call this when creating an agent
   */
  registerThread(threadId: string, components: IComponent[]): void {
    this.threads.set(threadId, {
      components,
      componentData: new Map(),
    });
  }

  /**
   * Unregister a thread (cleanup when agent is deleted)
   */
  unregisterThread(threadId: string): void {
    this.threads.delete(threadId);
  }

  /**
   * Get all active component instances for a thread
   * Returns empty array if thread not found
   */
  getActiveComponents(threadId?: string): IComponent[] {
    if (!threadId) {
      // Return all components across all threads (for global queries)
      const allComponents: IComponent[] = [];
      for (const data of this.threads.values()) {
        allComponents.push(...data.components);
      }
      return allComponents;
    }

    const data = this.threads.get(threadId);
    return data?.components ?? [];
  }

  /**
   * Get component instances for a specific thread
   */
  getThreadComponents(threadId: string): IComponent[] {
    return this.threads.get(threadId)?.components ?? [];
  }

  /**
   * Get a component context for executing reducers
   *
   * The context provides:
   * - threadId, componentKey for identification
   * - getOwnedChunks() for chunk access
   * - getData/setData for component-specific state
   */
  getComponentContext(
    threadId: string,
    componentKey: string,
    state: MemoryState,
  ): ComponentContext {
    const threadData = this.threads.get(threadId);

    // Get or create component data map
    let componentDataMap = threadData?.componentData.get(componentKey);
    if (!componentDataMap && threadData) {
      componentDataMap = new Map();
      threadData.componentData.set(componentKey, componentDataMap);
    }

    // Build runtime state from stored data
    const runtimeState: ComponentRuntimeState = {
      componentKey,
      enabled: true,
      chunkIds: this.getComponentChunkIds(state, componentKey),
      data: this.mapToObject(componentDataMap),
    };

    // Create context using factory function
    const context = createComponentContext(
      threadId,
      componentKey,
      state,
      runtimeState,
    );

    // Wrap setData to also update our local storage
    const originalSetData = context.setData.bind(context);
    return {
      ...context,
      setData: <T>(key: string, value: T): void => {
        originalSetData(key, value);
        componentDataMap?.set(key, value);
      },
    };
  }

  /**
   * Get chunk IDs owned by a component
   */
  private getComponentChunkIds(
    state: MemoryState,
    componentKey: string,
  ): string[] {
    const chunkIds: string[] = [];
    for (const [chunkId, chunk] of state.chunks) {
      if (chunk.componentKey === componentKey) {
        chunkIds.push(chunkId);
      }
    }
    return chunkIds;
  }

  /**
   * Convert Map to plain object
   */
  private mapToObject(
    map: Map<string, unknown> | undefined,
  ): Record<string, unknown> {
    if (!map) return {};
    const obj: Record<string, unknown> = {};
    for (const [key, value] of map) {
      obj[key] = value;
    }
    return obj;
  }

  /**
   * Check if a thread is registered
   */
  hasThread(threadId: string): boolean {
    return this.threads.has(threadId);
  }

  /**
   * Get all registered thread IDs
   */
  getThreadIds(): string[] {
    return Array.from(this.threads.keys());
  }
}

/**
 * Create a new ThreadComponentProvider
 */
export function createThreadComponentProvider(): ThreadComponentProvider {
  return new ThreadComponentProvider();
}
