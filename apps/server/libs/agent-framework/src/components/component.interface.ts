/**
 * Component Interface Definitions
 * Components are first-class citizens that encapsulate chunks, tools, events, and rendering logic
 */

import type {
  MemoryChunk,
  ChunkType,
  ChunkContent,
  ChunkRetentionStrategy,
} from '../types/chunk.types.js';
import type { MemoryState } from '../types/state.types.js';
import type { AgentEvent } from '../types/event.types.js';
import type { Operation } from '../types/operation.types.js';
import type { ReducerResult } from '../reducer/reducer.types.js';
import type { Tool } from '../tools/tool.types.js';

// ============ Render Configuration ============

/**
 * Render location for component content
 * - 'system': Rendered in system prompt (stable context)
 * - 'flow': Rendered in conversation flow (user/assistant messages)
 */
export type RenderLocation = 'system' | 'flow';

/**
 * A single rendered fragment from a chunk
 * One chunk can produce multiple fragments at different locations
 */
export interface RenderedFragment {
  /** The actual text content to render */
  content: string;
  /** Where to render this fragment */
  location: RenderLocation;
  /**
   * Order within the location (lower = earlier). Range: 0-1000
   * Default: 500
   *
   * Recommended ranges:
   * - 0-100: Static content (base instructions, never changes)
   * - 100-300: Semi-static content (loaded documents, rarely changes)
   * - 300-1000: Dynamic content (conversation, todos, frequently changes)
   */
  order?: number;
}

// ============ Component Context ============

/**
 * Context provided to component lifecycle hooks and methods
 */
export interface ComponentContext {
  /** Current thread ID */
  threadId: string;
  /** Component ID */
  componentId: string;
  /**
   * Get all chunks owned by this component
   */
  getOwnedChunks(): MemoryChunk[];
  /**
   * Get component-specific data
   * @param key - Data key
   */
  getData<T>(key: string): T | undefined;
  /**
   * Set component-specific data (persisted across events)
   * @param key - Data key
   * @param value - Data value
   */
  setData<T>(key: string, value: T): void;
}

// ============ Component Validation ============

/**
 * Component validation issue
 */
export interface ComponentValidationIssue {
  /** Error message */
  message: string;
  /** Severity level (default: 'error') */
  level?: 'error' | 'warning';
}

// ============ Component Lifecycle ============

/**
 * Component lifecycle hooks
 */
export interface ComponentLifecycle {
  /**
   * Called when component is first loaded into a thread
   * Use this for one-time initialization
   */
  onInitialize?(context: ComponentContext): Promise<void> | void;

  /**
   * Called when component is activated (enabled)
   * This is called after onInitialize on first load, and after re-enabling
   */
  onActivate?(context: ComponentContext): Promise<void> | void;

  /**
   * Called when component is deactivated (disabled)
   * Component's chunks will be removed after this hook
   */
  onDeactivate?(context: ComponentContext): Promise<void> | void;

  /**
   * Called when component is completely removed from thread
   * Use this for cleanup
   */
  onDestroy?(context: ComponentContext): Promise<void> | void;
}

// ============ Chunk Storage Interface ============

/**
 * Interface for chunk persistence operations
 */
export interface IChunkStorage {
  /** Get a chunk by ID */
  get(chunkId: string): MemoryChunk | undefined;
  /** Save/update a chunk */
  save(chunk: MemoryChunk): void;
  /** Delete a chunk */
  delete(chunkId: string): void;
  /** Add a chunk to the ordered list */
  addToOrder(chunkId: string, position?: number): void;
  /** Remove a chunk from the ordered list */
  removeFromOrder(chunkId: string): void;
  /** Reorder a chunk */
  reorder(chunkId: string, newPosition: number): void;
}

/**
 * Operation handler function for a chunk
 * @returns true if the operation was handled, false to pass to next handler
 */
export type ChunkOperationHandler = (
  operation: Operation,
  chunk: MemoryChunk,
  storage: IChunkStorage,
) => boolean | Promise<boolean>;

// ============ Component Chunk Configuration ============

/**
 * Component chunk configuration
 * Defines how a component manages its chunks
 */
export interface ComponentChunkConfig {
  /** Unique key within this component (used to identify chunk purpose) */
  key: string;
  /** Initial content or content factory function */
  initialContent: ChunkContent | ((context: ComponentContext) => ChunkContent);
  /** Chunk type */
  type: ChunkType;
  /** Retention strategy */
  retentionStrategy: ChunkRetentionStrategy;
  /** Whether this chunk can be modified at runtime */
  mutable: boolean;
  /** Priority for ordering within type (higher = more important) */
  priority: number;
  /**
   * Operation handler for this chunk
   * Called when an operation targets this chunk
   * @returns true if handled, false to pass to default handler
   */
  onOperation?: ChunkOperationHandler;
}

// ============ Component Event Configuration ============

/**
 * Component reducer function
 * Processes an event and returns operations to apply
 */
export type ComponentReducerFn = (
  state: MemoryState,
  event: AgentEvent,
  context: ComponentContext,
) => ReducerResult | Promise<ReducerResult>;

// ============ Main Component Interface ============

/**
 * New component type (Component-Centric architecture)
 * - 'base': Core framework component, always present, cannot be disabled (implicit, no need to specify)
 * - 'stable': Stable component, once specified in blueprint, cannot be disabled at runtime
 * - 'pluggable': Can be enabled/disabled at runtime via events
 *
 * Note: This is distinct from the legacy ComponentType ('system' | 'agent' | 'workflow')
 * which is defined in component.types.ts for backwards compatibility
 */
export type NewComponentType = 'base' | 'stable' | 'pluggable';

/**
 * Main Component interface
 * Components are the primary abstraction for organizing agent functionality
 */
export interface IComponent extends ComponentLifecycle {
  // ============ Identity ============

  /** Unique component identifier */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Component type */
  readonly type: NewComponentType;

  /**
   * Dependencies on other components (by id)
   * This component requires these components to be enabled before it can be enabled
   * Dependency components will be automatically enabled when this component is enabled
   */
  readonly dependencies?: string[];

  // ============ Chunk Management ============

  /**
   * Get chunk configurations managed by this component
   * These define the blueprint for chunks this component creates
   */
  getChunkConfigs(): ComponentChunkConfig[];

  /**
   * Create initial chunks for this component
   * Called when component is activated
   * @param context - Component context
   */
  createInitialChunks(context: ComponentContext): MemoryChunk[];

  /**
   * Get chunk IDs owned by this component from current state
   * @param state - Current memory state
   */
  getOwnedChunkIds(state: MemoryState): string[];

  // ============ Tools ============

  /**
   * Get tools provided by this component
   * Tools are available when the component is enabled
   */
  getTools(): Tool[];

  // ============ Event Handling ============

  /**
   * Filter an event and return reducers that should handle it
   * @param event - The event to filter
   * @returns Array of reducer functions to execute, or empty array if event should be ignored
   */
  getReducersForEvent(event: AgentEvent): ComponentReducerFn[];

  // ============ Rendering ============

  /**
   * Render a chunk to prompt fragments
   * One chunk can produce multiple fragments at different locations
   * @param chunk - The chunk to render
   * @param context - Component context
   * @returns Array of rendered fragments
   */
  renderChunk(
    chunk: MemoryChunk,
    context: ComponentContext,
  ): RenderedFragment[];

  // ============ Validation ============

  /**
   * Validate component configuration (optional)
   * Called during blueprint validation
   * @returns Array of validation issues (errors and warnings)
   */
  validate?(): ComponentValidationIssue[];
}

// ============ Component Configuration ============

/**
 * Component constructor type with optional static blueprint validation
 */
export type ComponentConstructor<TConfig = Record<string, unknown>> = {
  new (config?: TConfig): IComponent;
  /**
   * Optional static method to validate blueprint component configuration
   * Called during blueprint validation before component instantiation
   * @param config - Blueprint component configuration object (legacy ComponentConfig or config object)
   * @returns Array of validation issues (errors and warnings), or null if validation not needed
   */
  validateBlueprintConfig?(config: unknown): ComponentValidationIssue[] | null;
};

/**
 * New component configuration for Blueprint (Component-Centric architecture)
 *
 * Note: This is distinct from the legacy ComponentConfig which is defined
 * in component.types.ts for backwards compatibility
 */
export interface NewComponentConfig<TConfig = Record<string, unknown>> {
  /** Component class or instance */
  component: IComponent | ComponentConstructor<TConfig>;
  /** Configuration to pass to component constructor */
  config?: TConfig;
}

/**
 * Type guard for IComponent instance
 */
export function isComponentInstance(value: unknown): value is IComponent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    'name' in value &&
    'type' in value &&
    'getChunkConfigs' in value &&
    typeof (value as IComponent).getChunkConfigs === 'function'
  );
}

// ============ Component State ============

/**
 * Runtime state for a component within a thread
 */
export interface ComponentRuntimeState {
  /** Component ID */
  componentId: string;
  /** Whether component is currently enabled */
  enabled: boolean;
  /** IDs of chunks owned by this component */
  chunkIds: string[];
  /** Component-specific data storage */
  data: Record<string, unknown>;
  /** Timestamp when component was activated */
  activatedAt?: number;
  /** Timestamp when component was deactivated */
  deactivatedAt?: number;
}
