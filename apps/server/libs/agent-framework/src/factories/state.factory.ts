import {
  MemoryState,
  CreateStateInput,
  StateMetadata,
  StateProvenance,
  SerializableMemoryState,
} from '../types/state.types.js';
import { MemoryChunk } from '../types/chunk.types.js';
import { generateStateId } from '../utils/id.utils.js';

/**
 * Deep freeze an object to make it immutable
 * @param obj - The object to freeze
 * @returns The frozen object
 */
function deepFreeze<T extends object>(obj: T): Readonly<T> {
  const propNames = Reflect.ownKeys(obj) as (keyof T)[];

  for (const name of propNames) {
    const value = obj[name];
    if (
      value &&
      typeof value === 'object' &&
      !Object.isFrozen(value) &&
      !(value instanceof Map)
    ) {
      deepFreeze(value as object);
    }
  }

  return Object.freeze(obj);
}

/**
 * Create an immutable Map from chunks
 * @param chunks - Array of chunks to convert
 * @returns An immutable Map
 */
function createImmutableChunkMap(
  chunks: MemoryChunk[],
): ReadonlyMap<string, MemoryChunk> {
  const map = new Map<string, MemoryChunk>();
  for (const chunk of chunks) {
    map.set(chunk.id, chunk);
  }
  return map;
}

/**
 * Create a new immutable Memory State
 * @param input - The input parameters for creating the state
 * @returns A frozen MemoryState object
 */
export function createState(input: CreateStateInput): Readonly<MemoryState> {
  const chunks = input.chunks ?? [];
  const chunkIds = chunks.map((chunk) => chunk.id);

  const metadata: StateMetadata = {
    createdAt: Date.now(),
    previousStateId: input.previousStateId,
    sourceOperation: input.sourceOperation,
    provenance: input.provenance,
    custom: input.custom,
  };

  const state: MemoryState = {
    id: generateStateId(),
    threadId: input.threadId,
    chunkIds: Object.freeze([...chunkIds]) as string[],
    chunks: createImmutableChunkMap(chunks),
    metadata: deepFreeze(metadata),
    needLLMContinueResponse: input.needLLMContinueResponse,
  };

  return Object.freeze(state);
}

/**
 * Create a derived state from an existing state
 * @param original - The original state to derive from
 * @param updates - Updates to apply (new chunks, modified chunk order, etc.)
 * @returns A new frozen MemoryState object
 */
export function deriveState(
  original: MemoryState,
  updates: {
    chunks?: MemoryChunk[];
    chunkIds?: string[];
    sourceOperation?: StateMetadata['sourceOperation'];
    provenance?: StateProvenance;
    custom?: Record<string, unknown>;
    needLLMContinueResponse?: boolean;
  },
): Readonly<MemoryState> {
  let newChunks: Map<string, MemoryChunk>;
  let newChunkIds: string[];

  if (updates.chunks !== undefined) {
    newChunks = new Map(updates.chunks.map((c) => [c.id, c]));
    newChunkIds = updates.chunkIds ?? updates.chunks.map((c) => c.id);
  } else {
    newChunks = new Map(original.chunks);
    newChunkIds = updates.chunkIds ?? [...original.chunkIds];
  }

  const metadata: StateMetadata = {
    createdAt: Date.now(),
    previousStateId: original.id,
    sourceOperation: updates.sourceOperation,
    provenance: updates.provenance,
    custom: updates.custom ?? original.metadata.custom,
  };

  const state: MemoryState = {
    id: generateStateId(),
    threadId: original.threadId,
    chunkIds: Object.freeze([...newChunkIds]) as string[],
    chunks: newChunks,
    metadata: deepFreeze(metadata),
    needLLMContinueResponse:
      'needLLMContinueResponse' in updates
        ? updates.needLLMContinueResponse
        : original.needLLMContinueResponse,
  };

  return Object.freeze(state);
}

/**
 * Convert MemoryState to a serializable format
 * @param state - The state to serialize
 * @returns A plain object that can be serialized to JSON
 */
export function serializeState(state: MemoryState): SerializableMemoryState {
  const chunks: Record<string, MemoryChunk> = {};
  for (const [id, chunk] of state.chunks) {
    chunks[id] = chunk;
  }

  return {
    id: state.id,
    threadId: state.threadId,
    chunkIds: [...state.chunkIds],
    chunks,
    metadata: { ...state.metadata },
    needLLMContinueResponse: state.needLLMContinueResponse,
  };
}

/**
 * Deserialize a SerializableMemoryState back to MemoryState
 * @param serialized - The serialized state
 * @returns A frozen MemoryState object
 */
export function deserializeState(
  serialized: SerializableMemoryState,
): Readonly<MemoryState> {
  const chunks = new Map<string, MemoryChunk>();
  for (const [id, chunk] of Object.entries(serialized.chunks)) {
    chunks.set(id, deepFreeze(chunk));
  }

  const state: MemoryState = {
    id: serialized.id,
    threadId: serialized.threadId,
    chunkIds: Object.freeze([...serialized.chunkIds]) as string[],
    chunks,
    metadata: deepFreeze({ ...serialized.metadata }),
    needLLMContinueResponse: serialized.needLLMContinueResponse,
  };

  return Object.freeze(state);
}

/**
 * Deep clone a memory state for temporary modification
 * Creates a mutable copy that can be safely modified without affecting the original.
 * Used for truncation where we need a temporary view of the state.
 *
 * Note: Unlike deriveState, this preserves the original ID since it's
 * meant for temporary manipulation, not creating a new persisted state.
 *
 * @param state - The state to clone
 * @returns A mutable copy of the state
 */
export function cloneState(state: MemoryState): MemoryState {
  // Clone chunks map
  const clonedChunks = new Map<string, MemoryChunk>();
  for (const [id, chunk] of state.chunks) {
    // Deep clone each chunk
    clonedChunks.set(id, {
      ...chunk,
      // Clone childIds array if present
      childIds: chunk.childIds ? [...chunk.childIds] : undefined,
      // Clone metadata
      metadata: {
        ...chunk.metadata,
        custom: chunk.metadata.custom
          ? { ...chunk.metadata.custom }
          : undefined,
      },
      // Note: content is assumed to be immutable (text/image data)
    });
  }

  return {
    ...state,
    chunkIds: [...state.chunkIds],
    chunks: clonedChunks,
    metadata: {
      ...state.metadata,
      custom: state.metadata.custom ? { ...state.metadata.custom } : undefined,
    },
  };
}
