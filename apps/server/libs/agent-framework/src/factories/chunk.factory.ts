import {
  MemoryChunk,
  CreateChunkInput,
  ChunkRetentionStrategy,
  ChunkType,
  ChunkMetadata,
} from '../types/chunk.types.js';
import { generateChunkId } from '../utils/id.utils.js';

/**
 * Default priority values for different chunk types
 */
const DEFAULT_PRIORITIES: Record<ChunkType, number> = {
  // Core types
  [ChunkType.SYSTEM]: 1000,
  [ChunkType.AGENT]: 900,
  [ChunkType.WORKFLOW]: 800,
  [ChunkType.DELEGATION]: 700,
  [ChunkType.ENVIRONMENT]: 600,
  [ChunkType.WORKING_HISTORY]: 500,
  [ChunkType.OUTPUT]: 400,
  // Conversation types (all same priority, ordered by creation time)
  [ChunkType.COMPACTED]: 500,
  [ChunkType.USER_MESSAGE]: 500,
  [ChunkType.THINKING]: 500,
  [ChunkType.AGENT_RESPONSE]: 500,
  [ChunkType.AGENT_ACTION]: 500,
  [ChunkType.ACTION_RESPONSE]: 500,
  [ChunkType.SUBAGENT_SPAWN]: 500,
  [ChunkType.SUBAGENT_RESULT]: 500,
  [ChunkType.PARENT_MESSAGE]: 500,
};

/**
 * Default retention strategies for different chunk types
 */
const DEFAULT_RETENTION_STRATEGIES: Record<ChunkType, ChunkRetentionStrategy> =
  {
    // Core types
    [ChunkType.SYSTEM]: ChunkRetentionStrategy.CRITICAL,
    [ChunkType.AGENT]: ChunkRetentionStrategy.CRITICAL,
    [ChunkType.WORKFLOW]: ChunkRetentionStrategy.CRITICAL,
    [ChunkType.DELEGATION]: ChunkRetentionStrategy.COMPRESSIBLE,
    [ChunkType.ENVIRONMENT]: ChunkRetentionStrategy.COMPRESSIBLE,
    [ChunkType.WORKING_HISTORY]: ChunkRetentionStrategy.CRITICAL,
    [ChunkType.OUTPUT]: ChunkRetentionStrategy.COMPRESSIBLE,
    // Conversation types
    [ChunkType.COMPACTED]: ChunkRetentionStrategy.COMPRESSIBLE,
    [ChunkType.USER_MESSAGE]: ChunkRetentionStrategy.COMPRESSIBLE,
    [ChunkType.THINKING]: ChunkRetentionStrategy.BATCH_COMPRESSIBLE,
    [ChunkType.AGENT_RESPONSE]: ChunkRetentionStrategy.COMPRESSIBLE,
    [ChunkType.AGENT_ACTION]: ChunkRetentionStrategy.BATCH_COMPRESSIBLE,
    [ChunkType.ACTION_RESPONSE]: ChunkRetentionStrategy.BATCH_COMPRESSIBLE,
    [ChunkType.SUBAGENT_SPAWN]: ChunkRetentionStrategy.COMPRESSIBLE,
    [ChunkType.SUBAGENT_RESULT]: ChunkRetentionStrategy.COMPRESSIBLE,
    [ChunkType.PARENT_MESSAGE]: ChunkRetentionStrategy.COMPRESSIBLE,
  };

/**
 * Default mutability for different chunk types
 */
const DEFAULT_MUTABILITY: Record<ChunkType, boolean> = {
  // Core types
  [ChunkType.SYSTEM]: false,
  [ChunkType.AGENT]: false,
  [ChunkType.WORKFLOW]: false,
  [ChunkType.DELEGATION]: true,
  [ChunkType.ENVIRONMENT]: false,
  [ChunkType.WORKING_HISTORY]: true,
  [ChunkType.OUTPUT]: false,
  // Conversation types (all immutable once created)
  [ChunkType.COMPACTED]: false,
  [ChunkType.USER_MESSAGE]: false,
  [ChunkType.THINKING]: false,
  [ChunkType.AGENT_RESPONSE]: false,
  [ChunkType.AGENT_ACTION]: false,
  [ChunkType.ACTION_RESPONSE]: false,
  [ChunkType.SUBAGENT_SPAWN]: false,
  [ChunkType.SUBAGENT_RESULT]: false,
  [ChunkType.PARENT_MESSAGE]: false,
};

/**
 * Deep freeze an object to make it immutable
 * @param obj - The object to freeze
 * @returns The frozen object
 */
function deepFreeze<T extends object>(obj: T): Readonly<T> {
  const propNames = Reflect.ownKeys(obj) as (keyof T)[];

  for (const name of propNames) {
    const value = obj[name];
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  }

  return Object.freeze(obj);
}

/**
 * Create a new immutable Memory Chunk
 * @param input - The input parameters for creating the chunk
 * @returns A frozen MemoryChunk object
 */
export function createChunk(input: CreateChunkInput): Readonly<MemoryChunk> {
  const metadata: ChunkMetadata = {
    createdAt: Date.now(),
    parentIds: input.parentIds,
    sourceOperation: input.sourceOperation,
    custom: input.custom,
  };

  const chunk: MemoryChunk = {
    id: generateChunkId(),
    componentKey: input.componentKey,
    chunkKey: input.chunkKey,
    type: input.type,
    content: input.content,
    childIds: input.childIds,
    retentionStrategy:
      input.retentionStrategy ?? DEFAULT_RETENTION_STRATEGIES[input.type],
    mutable: input.mutable ?? DEFAULT_MUTABILITY[input.type],
    priority: input.priority ?? DEFAULT_PRIORITIES[input.type],
    metadata,
  };

  return deepFreeze(chunk);
}

/**
 * Create a derived chunk from an existing chunk (for updates)
 * The new chunk will have the original chunk as its parent
 * @param original - The original chunk to derive from
 * @param updates - Partial updates to apply
 * @returns A new frozen MemoryChunk object
 */
export function deriveChunk(
  original: MemoryChunk,
  updates: Partial<
    Omit<CreateChunkInput, 'parentIds' | 'sourceOperation' | 'custom'>
  > & {
    parentIds?: string[];
    sourceOperation?: CreateChunkInput['sourceOperation'];
    custom?: Record<string, unknown>;
  },
): Readonly<MemoryChunk> {
  const parentIds = updates.parentIds ?? [original.id];

  return createChunk({
    componentKey: updates.componentKey ?? original.componentKey,
    chunkKey: updates.chunkKey ?? original.chunkKey,
    type: updates.type ?? original.type,
    content: updates.content ?? original.content,
    retentionStrategy: updates.retentionStrategy ?? original.retentionStrategy,
    mutable: updates.mutable ?? original.mutable,
    priority: updates.priority ?? original.priority,
    parentIds,
    sourceOperation: updates.sourceOperation,
    custom: updates.custom ?? original.metadata.custom,
  });
}
