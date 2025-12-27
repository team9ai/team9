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
  [ChunkType.SYSTEM]: 1000,
  [ChunkType.AGENT]: 900,
  [ChunkType.WORKFLOW]: 800,
  [ChunkType.DELEGATION]: 700,
  [ChunkType.ENVIRONMENT]: 600,
  [ChunkType.WORKING_FLOW]: 500,
  [ChunkType.OUTPUT]: 400,
};

/**
 * Default retention strategies for different chunk types
 */
const DEFAULT_RETENTION_STRATEGIES: Record<ChunkType, ChunkRetentionStrategy> =
  {
    [ChunkType.SYSTEM]: ChunkRetentionStrategy.CRITICAL,
    [ChunkType.AGENT]: ChunkRetentionStrategy.CRITICAL,
    [ChunkType.WORKFLOW]: ChunkRetentionStrategy.CRITICAL,
    [ChunkType.DELEGATION]: ChunkRetentionStrategy.COMPRESSIBLE,
    [ChunkType.ENVIRONMENT]: ChunkRetentionStrategy.COMPRESSIBLE,
    [ChunkType.WORKING_FLOW]: ChunkRetentionStrategy.BATCH_COMPRESSIBLE,
    [ChunkType.OUTPUT]: ChunkRetentionStrategy.COMPRESSIBLE,
  };

/**
 * Default mutability for different chunk types
 */
const DEFAULT_MUTABILITY: Record<ChunkType, boolean> = {
  [ChunkType.SYSTEM]: false,
  [ChunkType.AGENT]: false,
  [ChunkType.WORKFLOW]: false,
  [ChunkType.DELEGATION]: true,
  [ChunkType.ENVIRONMENT]: false,
  [ChunkType.WORKING_FLOW]: true,
  [ChunkType.OUTPUT]: false,
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
    type: input.type,
    subType: input.subType,
    content: input.content,
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
    type: updates.type ?? original.type,
    subType: updates.subType ?? original.subType,
    content: updates.content ?? original.content,
    retentionStrategy: updates.retentionStrategy ?? original.retentionStrategy,
    mutable: updates.mutable ?? original.mutable,
    priority: updates.priority ?? original.priority,
    parentIds,
    sourceOperation: updates.sourceOperation,
    custom: updates.custom ?? original.metadata.custom,
  });
}
