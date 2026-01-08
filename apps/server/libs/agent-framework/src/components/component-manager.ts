/**
 * ComponentManager - Manages component lifecycle and aggregation
 *
 * Responsibilities:
 * 1. Component registration and dependency validation
 * 2. Thread initialization with components
 * 3. Hot-pluggable component enable/disable
 * 4. Reducer aggregation from enabled components
 * 5. Tool aggregation from enabled components
 */

import type { MemoryChunk } from '../types/chunk.types.js';
import type { MemoryState } from '../types/state.types.js';
import type { AgentEvent } from '../types/event.types.js';
import type { Tool } from '../tools/tool.types.js';
import type { ReducerResult } from '../reducer/reducer.types.js';
import type {
  IComponent,
  ComponentContext,
  ComponentReducerFn,
  ComponentRuntimeState,
  RenderedFragment,
} from './component.interface.js';

/**
 * Configuration for ComponentManager
 */
export interface ComponentManagerConfig {
  /** Base components that are always enabled */
  baseComponents?: IComponent[];
}

/**
 * Thread component state - tracks which components are enabled per thread
 */
interface ThreadComponentState {
  /** Component ID -> Runtime state */
  components: Map<string, ComponentRuntimeState>;
  /** Component ID -> Component instance */
  instances: Map<string, IComponent>;
}

/**
 * Component context implementation
 */
class DefaultComponentContext implements ComponentContext {
  public readonly threadId: string;
  public readonly componentId: string;
  private readonly state: MemoryState;
  private readonly runtimeState: ComponentRuntimeState;

  constructor(
    threadId: string,
    componentId: string,
    state: MemoryState,
    runtimeState: ComponentRuntimeState,
  ) {
    this.threadId = threadId;
    this.componentId = componentId;
    this.state = state;
    this.runtimeState = runtimeState;
  }

  getOwnedChunks(): MemoryChunk[] {
    return this.runtimeState.chunkIds
      .map((id) => this.state.chunks.get(id))
      .filter((chunk): chunk is MemoryChunk => chunk !== undefined);
  }

  getData<T>(key: string): T | undefined {
    return this.runtimeState.data[key] as T | undefined;
  }

  setData<T>(key: string, value: T): void {
    this.runtimeState.data[key] = value;
  }
}

/**
 * ComponentManager manages component registration, lifecycle, and aggregation
 */
export class ComponentManager {
  /** Registered components (global) */
  private registeredComponents: Map<string, IComponent> = new Map();

  /** Thread-specific component states */
  private threadStates: Map<string, ThreadComponentState> = new Map();

  /** Base components (always enabled) */
  private baseComponents: IComponent[] = [];

  constructor(config?: ComponentManagerConfig) {
    // Register base components
    if (config?.baseComponents) {
      for (const component of config.baseComponents) {
        this.registerComponent(component);
        this.baseComponents.push(component);
      }
    }
  }

  // ============ Component Registration ============

  /**
   * Register a component globally
   * @throws Error if component with same ID already registered
   */
  registerComponent(component: IComponent): void {
    if (this.registeredComponents.has(component.id)) {
      throw new Error(`Component already registered: ${component.id}`);
    }

    // Validate dependencies exist
    if (component.dependencies) {
      for (const depId of component.dependencies) {
        if (!this.registeredComponents.has(depId)) {
          throw new Error(
            `Component ${component.id} depends on unregistered component: ${depId}`,
          );
        }
      }
    }

    this.registeredComponents.set(component.id, component);
  }

  /**
   * Unregister a component
   * @throws Error if component is a base component or has dependents
   */
  unregisterComponent(componentId: string): void {
    // Check if base component
    if (this.baseComponents.some((c) => c.id === componentId)) {
      throw new Error(`Cannot unregister base component: ${componentId}`);
    }

    // Check for dependents
    for (const [id, component] of this.registeredComponents) {
      if (component.dependencies?.includes(componentId)) {
        throw new Error(
          `Cannot unregister ${componentId}: component ${id} depends on it`,
        );
      }
    }

    this.registeredComponents.delete(componentId);
  }

  /**
   * Get a registered component by ID
   */
  getComponent(componentId: string): IComponent | undefined {
    return this.registeredComponents.get(componentId);
  }

  /**
   * Get all registered components
   */
  getAllComponents(): IComponent[] {
    return Array.from(this.registeredComponents.values());
  }

  // ============ Thread Initialization ============

  /**
   * Initialize components for a new thread
   * @param threadId - Thread ID
   * @param componentIds - Component IDs to enable (in addition to base components)
   * @returns Initial chunks to add to the thread
   */
  async initializeThread(
    threadId: string,
    state: MemoryState,
    componentIds: string[] = [],
  ): Promise<{
    chunks: MemoryChunk[];
    tools: Tool[];
  }> {
    // Create thread state
    const threadState: ThreadComponentState = {
      components: new Map(),
      instances: new Map(),
    };
    this.threadStates.set(threadId, threadState);

    const allChunks: MemoryChunk[] = [];
    const allTools: Tool[] = [];

    // Enable base components first
    for (const component of this.baseComponents) {
      const result = await this.enableComponentInternal(
        threadId,
        component,
        state,
        threadState,
      );
      allChunks.push(...result.chunks);
      allTools.push(...result.tools);
    }

    // Enable additional components
    for (const componentId of componentIds) {
      const component = this.registeredComponents.get(componentId);
      if (!component) {
        throw new Error(`Component not registered: ${componentId}`);
      }

      // Skip if already enabled (base component)
      if (threadState.components.has(componentId)) {
        continue;
      }

      const result = await this.enableComponentInternal(
        threadId,
        component,
        state,
        threadState,
      );
      allChunks.push(...result.chunks);
      allTools.push(...result.tools);
    }

    return { chunks: allChunks, tools: allTools };
  }

  /**
   * Clean up thread state
   */
  async destroyThread(threadId: string): Promise<void> {
    const threadState = this.threadStates.get(threadId);
    if (!threadState) {
      return;
    }

    // Call onDestroy for all components
    for (const [componentId, instance] of threadState.instances) {
      const runtimeState = threadState.components.get(componentId);
      if (runtimeState && instance.onDestroy) {
        const context = this.createContext(
          threadId,
          componentId,
          { chunks: new Map(), chunkIds: [] } as unknown as MemoryState,
          runtimeState,
        );
        await instance.onDestroy(context);
      }
    }

    this.threadStates.delete(threadId);
  }

  // ============ Hot-Plug Component Management ============

  /**
   * Enable a component for a thread
   * @returns Chunks to add to the thread
   */
  async enableComponent(
    threadId: string,
    componentId: string,
    state: MemoryState,
  ): Promise<{ chunks: MemoryChunk[]; tools: Tool[] }> {
    const threadState = this.threadStates.get(threadId);
    if (!threadState) {
      throw new Error(`Thread not initialized: ${threadId}`);
    }

    const component = this.registeredComponents.get(componentId);
    if (!component) {
      throw new Error(`Component not registered: ${componentId}`);
    }

    // Check if already enabled
    const existingState = threadState.components.get(componentId);
    if (existingState?.enabled) {
      return { chunks: [], tools: [] };
    }

    // Check if component can be enabled (not base type and marked as pluggable)
    if (component.type === 'base') {
      throw new Error(`Cannot manually enable base component: ${componentId}`);
    }

    return this.enableComponentInternal(
      threadId,
      component,
      state,
      threadState,
    );
  }

  /**
   * Disable a component for a thread
   * @returns Chunk IDs to remove from the thread
   */
  async disableComponent(
    threadId: string,
    componentId: string,
    state: MemoryState,
  ): Promise<{ removedChunkIds: string[] }> {
    const threadState = this.threadStates.get(threadId);
    if (!threadState) {
      throw new Error(`Thread not initialized: ${threadId}`);
    }

    const runtimeState = threadState.components.get(componentId);
    if (!runtimeState || !runtimeState.enabled) {
      return { removedChunkIds: [] };
    }

    const component = threadState.instances.get(componentId);
    if (!component) {
      return { removedChunkIds: [] };
    }

    // Check if component can be disabled
    if (component.type === 'base') {
      throw new Error(`Cannot disable base component: ${componentId}`);
    }

    if (component.type === 'stable') {
      throw new Error(`Cannot disable stable component: ${componentId}`);
    }

    // Check if other components depend on this one
    for (const [id, instance] of threadState.instances) {
      const otherState = threadState.components.get(id);
      if (otherState?.enabled && instance.dependencies?.includes(componentId)) {
        throw new Error(
          `Cannot disable ${componentId}: component ${id} depends on it`,
        );
      }
    }

    // Call onDeactivate
    if (component.onDeactivate) {
      const context = this.createContext(
        threadId,
        componentId,
        state,
        runtimeState,
      );
      await component.onDeactivate(context);
    }

    // Update runtime state
    runtimeState.enabled = false;
    runtimeState.deactivatedAt = Date.now();
    const removedChunkIds = [...runtimeState.chunkIds];
    runtimeState.chunkIds = [];

    return { removedChunkIds };
  }

  /**
   * Check if a component is enabled for a thread
   */
  isComponentEnabled(threadId: string, componentId: string): boolean {
    const threadState = this.threadStates.get(threadId);
    if (!threadState) {
      return false;
    }
    const runtimeState = threadState.components.get(componentId);
    return runtimeState?.enabled ?? false;
  }

  /**
   * Get all enabled components for a thread
   */
  getEnabledComponents(threadId: string): IComponent[] {
    const threadState = this.threadStates.get(threadId);
    if (!threadState) {
      return [];
    }

    const enabled: IComponent[] = [];
    for (const [componentId, runtimeState] of threadState.components) {
      if (runtimeState.enabled) {
        const instance = threadState.instances.get(componentId);
        if (instance) {
          enabled.push(instance);
        }
      }
    }
    return enabled;
  }

  // ============ Event Handling Aggregation ============

  /**
   * Get all reducers for an event from enabled components
   */
  getReducersForEvent(
    threadId: string,
    event: AgentEvent,
    state: MemoryState,
  ): Array<{
    component: IComponent;
    reducer: ComponentReducerFn;
    context: ComponentContext;
  }> {
    const threadState = this.threadStates.get(threadId);
    if (!threadState) {
      return [];
    }

    const result: Array<{
      component: IComponent;
      reducer: ComponentReducerFn;
      context: ComponentContext;
    }> = [];

    for (const [componentId, runtimeState] of threadState.components) {
      if (!runtimeState.enabled) continue;

      const component = threadState.instances.get(componentId);
      if (!component) continue;

      const reducers = component.getReducersForEvent(event);
      const context = this.createContext(
        threadId,
        componentId,
        state,
        runtimeState,
      );

      for (const reducer of reducers) {
        result.push({ component, reducer, context });
      }
    }

    return result;
  }

  /**
   * Execute all reducers for an event
   */
  async reduceEvent(
    threadId: string,
    event: AgentEvent,
    state: MemoryState,
  ): Promise<ReducerResult> {
    const reducerInfos = this.getReducersForEvent(threadId, event, state);

    const allOperations: ReducerResult['operations'] = [];
    const allChunks: ReducerResult['chunks'] = [];

    for (const { reducer, context } of reducerInfos) {
      const result = await reducer(state, event, context);
      allOperations.push(...result.operations);
      allChunks.push(...result.chunks);
    }

    return {
      operations: allOperations,
      chunks: allChunks,
    };
  }

  // ============ Tool Aggregation ============

  /**
   * Get all tools from enabled components
   */
  getToolsForThread(threadId: string): Tool[] {
    const threadState = this.threadStates.get(threadId);
    if (!threadState) {
      return [];
    }

    const tools: Tool[] = [];
    for (const [componentId, runtimeState] of threadState.components) {
      if (!runtimeState.enabled) continue;

      const component = threadState.instances.get(componentId);
      if (!component) continue;

      tools.push(...component.getTools());
    }

    return tools;
  }

  // ============ Rendering Aggregation ============

  /**
   * Render all chunks from enabled components
   */
  renderChunks(threadId: string, state: MemoryState): RenderedFragment[] {
    const threadState = this.threadStates.get(threadId);
    if (!threadState) {
      return [];
    }

    const fragments: RenderedFragment[] = [];

    for (const [componentId, runtimeState] of threadState.components) {
      if (!runtimeState.enabled) continue;

      const component = threadState.instances.get(componentId);
      if (!component) continue;

      const context = this.createContext(
        threadId,
        componentId,
        state,
        runtimeState,
      );

      // Render each owned chunk
      for (const chunkId of runtimeState.chunkIds) {
        const chunk = state.chunks.get(chunkId);
        if (!chunk) continue;

        const rendered = component.renderChunk(chunk, context);
        fragments.push(...rendered);
      }
    }

    // Sort by location and order
    return fragments.sort((a, b) => {
      // Location priority: system (0) < flow (1)
      const locOrder = { system: 0, flow: 1 };
      const locDiff = locOrder[a.location] - locOrder[b.location];
      if (locDiff !== 0) return locDiff;

      // Then by order
      return (a.order ?? 500) - (b.order ?? 500);
    });
  }

  // ============ Component Context Access ============

  /**
   * Get component context for a thread
   */
  getComponentContext(
    threadId: string,
    componentId: string,
    state: MemoryState,
  ): ComponentContext | undefined {
    const threadState = this.threadStates.get(threadId);
    if (!threadState) return undefined;

    const runtimeState = threadState.components.get(componentId);
    if (!runtimeState) return undefined;

    return this.createContext(threadId, componentId, state, runtimeState);
  }

  /**
   * Get component runtime state
   */
  getComponentRuntimeState(
    threadId: string,
    componentId: string,
  ): ComponentRuntimeState | undefined {
    const threadState = this.threadStates.get(threadId);
    if (!threadState) return undefined;
    return threadState.components.get(componentId);
  }

  // ============ Private Helpers ============

  private async enableComponentInternal(
    threadId: string,
    component: IComponent,
    state: MemoryState,
    threadState: ThreadComponentState,
  ): Promise<{ chunks: MemoryChunk[]; tools: Tool[] }> {
    // Enable dependencies first
    if (component.dependencies) {
      for (const depId of component.dependencies) {
        if (!threadState.components.get(depId)?.enabled) {
          const depComponent = this.registeredComponents.get(depId);
          if (!depComponent) {
            throw new Error(`Dependency not registered: ${depId}`);
          }
          await this.enableComponentInternal(
            threadId,
            depComponent,
            state,
            threadState,
          );
        }
      }
    }

    // Create runtime state
    const runtimeState: ComponentRuntimeState = {
      componentId: component.id,
      enabled: true,
      chunkIds: [],
      data: {},
      activatedAt: Date.now(),
    };

    threadState.components.set(component.id, runtimeState);
    threadState.instances.set(component.id, component);

    const context = this.createContext(
      threadId,
      component.id,
      state,
      runtimeState,
    );

    // Call onInitialize
    if (component.onInitialize) {
      await component.onInitialize(context);
    }

    // Create initial chunks
    const chunks = component.createInitialChunks(context);
    runtimeState.chunkIds = chunks.map((c) => c.id);

    // Call onActivate
    if (component.onActivate) {
      await component.onActivate(context);
    }

    // Get tools
    const tools = component.getTools();

    return { chunks, tools };
  }

  private createContext(
    threadId: string,
    componentId: string,
    state: MemoryState,
    runtimeState: ComponentRuntimeState,
  ): ComponentContext {
    return new DefaultComponentContext(
      threadId,
      componentId,
      state,
      runtimeState,
    );
  }
}

/**
 * Create a new ComponentManager
 */
export function createComponentManager(
  config?: ComponentManagerConfig,
): ComponentManager {
  return new ComponentManager(config);
}
