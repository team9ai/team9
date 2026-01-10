import { MemoryState, StateProvenance } from '../types/state.types.js';
import { LLMResponseRequirement } from '../types/event.types.js';
import { MemoryChunk } from '../types/chunk.types.js';
import {
  Operation,
  OperationType,
  AddOperation,
  UpdateOperation,
  DeleteOperation,
  ReorderOperation,
  ReplaceOperation,
  BatchReplaceOperation,
  BatchOperation,
} from '../types/operation.types.js';
import { deriveState } from '../factories/state.factory.js';
import { StorageProvider } from '../storage/storage.types.js';
import { generateChunkId } from '../utils/id.utils.js';

/**
 * Result of applying an operation
 */
export interface ApplyResult {
  /** The new state after applying the operation */
  state: Readonly<MemoryState>;
  /** Chunks that were added during this operation */
  addedChunks: MemoryChunk[];
  /** Chunk IDs that were removed during this operation */
  removedChunkIds: string[];
}

/**
 * Context for operation execution
 *
 * TODO: Consider making chunk creation an operation itself to eliminate pendingChunks.
 * Alternative: ADD operation could carry chunk data directly instead of referencing chunkId.
 */
export interface ExecutionContext {
  /** Map of chunk ID to chunk for chunks being added */
  pendingChunks: Map<string, MemoryChunk>;
  /** Storage provider for persistence */
  storage: StorageProvider;
}

/**
 * Apply a single operation to the state (internal, computes new state)
 */
function applySingleOperationInternal(
  state: MemoryState,
  operation: Exclude<Operation, BatchOperation>,
  pendingChunks: Map<string, MemoryChunk>,
): ApplyResult {
  const chunks = new Map(state.chunks);
  let chunkIds = [...state.chunkIds];
  const addedChunks: MemoryChunk[] = [];
  const removedChunkIds: string[] = [];

  switch (operation.type) {
    case OperationType.ADD: {
      const addOp = operation as AddOperation;

      // Check if this is adding a child to an existing chunk (legacy behavior for childIds)
      if (addOp.parentChunkId && addOp.child) {
        const targetChunk = chunks.get(addOp.parentChunkId);
        if (!targetChunk) {
          throw new Error(
            `Parent chunk not found in state: ${addOp.parentChunkId}`,
          );
        }
        // Create a NEW chunk with a NEW ID containing the updated childIds
        // This ensures each state has its own immutable snapshot of the chunk
        // and prevents upsert operations from overwriting historical data
        const newChunkId = generateChunkId();
        const updatedChunk: MemoryChunk = {
          ...targetChunk,
          id: newChunkId,
          childIds: [...(targetChunk.childIds ?? []), addOp.child.id],
          metadata: {
            ...targetChunk.metadata,
            custom: {
              ...targetChunk.metadata.custom,
              derivedFrom: addOp.parentChunkId,
            },
          },
        };
        // Remove the old chunk and add the new one at the same position
        const oldIndex = chunkIds.indexOf(addOp.parentChunkId);
        chunks.delete(addOp.parentChunkId);
        chunks.set(newChunkId, updatedChunk);
        if (oldIndex !== -1) {
          chunkIds[oldIndex] = newChunkId;
        }
        // The new chunk needs to be persisted (old chunk remains in DB for historical states)
        addedChunks.push(updatedChunk);
      } else if (addOp.chunkId) {
        // Adding a top-level chunk
        const chunk = pendingChunks.get(addOp.chunkId);
        if (!chunk) {
          throw new Error(`Chunk not found in context: ${addOp.chunkId}`);
        }
        chunks.set(addOp.chunkId, chunk);
        if (addOp.position !== undefined && addOp.position >= 0) {
          chunkIds.splice(addOp.position, 0, addOp.chunkId);
        } else {
          chunkIds.push(addOp.chunkId);
        }
        addedChunks.push(chunk);
      } else {
        throw new Error(
          'ADD operation must have either chunkId or parentChunkId with child',
        );
      }
      break;
    }

    case OperationType.UPDATE: {
      const updateOp = operation as UpdateOperation;
      const newChunk = pendingChunks.get(updateOp.newChunkId);
      if (!newChunk) {
        throw new Error(`Chunk not found in context: ${updateOp.newChunkId}`);
      }
      const targetIndex = chunkIds.indexOf(updateOp.targetChunkId);
      if (targetIndex === -1) {
        throw new Error(
          `Target chunk not found in state: ${updateOp.targetChunkId}`,
        );
      }
      chunks.delete(updateOp.targetChunkId);
      chunks.set(updateOp.newChunkId, newChunk);
      chunkIds[targetIndex] = updateOp.newChunkId;
      removedChunkIds.push(updateOp.targetChunkId);
      addedChunks.push(newChunk);
      break;
    }

    case OperationType.DELETE: {
      const deleteOp = operation as DeleteOperation;
      const targetIndex = chunkIds.indexOf(deleteOp.chunkId);
      if (targetIndex === -1) {
        throw new Error(`Target chunk not found in state: ${deleteOp.chunkId}`);
      }
      chunks.delete(deleteOp.chunkId);
      chunkIds.splice(targetIndex, 1);
      removedChunkIds.push(deleteOp.chunkId);
      break;
    }

    case OperationType.REORDER: {
      const reorderOp = operation as ReorderOperation;
      const currentIndex = chunkIds.indexOf(reorderOp.chunkId);
      if (currentIndex === -1) {
        throw new Error(
          `Target chunk not found in state: ${reorderOp.chunkId}`,
        );
      }
      chunkIds.splice(currentIndex, 1);
      chunkIds.splice(reorderOp.newPosition, 0, reorderOp.chunkId);
      break;
    }

    case OperationType.REPLACE: {
      const replaceOp = operation as ReplaceOperation;
      const newChunk = pendingChunks.get(replaceOp.newChunkId);
      if (!newChunk) {
        throw new Error(`Chunk not found in context: ${replaceOp.newChunkId}`);
      }
      const targetIndex = chunkIds.indexOf(replaceOp.targetChunkId);
      if (targetIndex === -1) {
        throw new Error(
          `Target chunk not found in state: ${replaceOp.targetChunkId}`,
        );
      }
      chunks.delete(replaceOp.targetChunkId);
      chunks.set(replaceOp.newChunkId, newChunk);
      chunkIds[targetIndex] = replaceOp.newChunkId;
      removedChunkIds.push(replaceOp.targetChunkId);
      addedChunks.push(newChunk);
      break;
    }

    case OperationType.BATCH_REPLACE: {
      const batchReplaceOp = operation as BatchReplaceOperation;
      const newChunk = pendingChunks.get(batchReplaceOp.newChunkId);
      if (!newChunk) {
        throw new Error(
          `Chunk not found in context: ${batchReplaceOp.newChunkId}`,
        );
      }
      // Find the position of the first target chunk
      let insertPosition = -1;
      for (const targetId of batchReplaceOp.targetChunkIds) {
        const idx = chunkIds.indexOf(targetId);
        if (idx !== -1) {
          if (insertPosition === -1 || idx < insertPosition) {
            insertPosition = idx;
          }
          chunks.delete(targetId);
          removedChunkIds.push(targetId);
        }
      }
      // Remove all target chunks from chunkIds
      chunkIds = chunkIds.filter(
        (id) => !batchReplaceOp.targetChunkIds.includes(id),
      );
      // Insert new chunk at the position of the first removed chunk
      if (insertPosition !== -1) {
        chunkIds.splice(insertPosition, 0, batchReplaceOp.newChunkId);
      } else {
        chunkIds.push(batchReplaceOp.newChunkId);
      }
      chunks.set(batchReplaceOp.newChunkId, newChunk);
      addedChunks.push(newChunk);
      break;
    }
  }

  const newState = deriveState(state, {
    chunks: Array.from(chunks.values()),
    chunkIds,
    sourceOperation: operation,
  });

  return {
    state: newState,
    addedChunks,
    removedChunkIds,
  };
}

/**
 * Compute the result of applying an operation (no persistence)
 */
function computeOperationResult(
  state: MemoryState,
  operation: Operation,
  pendingChunks: Map<string, MemoryChunk>,
): ApplyResult {
  if (operation.type === OperationType.BATCH) {
    const batchOp = operation as BatchOperation;
    let currentState = state;
    const allAddedChunks: MemoryChunk[] = [];
    const allRemovedChunkIds: string[] = [];

    for (const nestedOp of batchOp.operations) {
      const result = computeOperationResult(
        currentState,
        nestedOp,
        pendingChunks,
      );
      currentState = result.state;
      allAddedChunks.push(...result.addedChunks);
      allRemovedChunkIds.push(...result.removedChunkIds);
    }

    // Update the final state to reference the batch operation as source
    const finalState = deriveState(currentState, {
      chunks: Array.from(currentState.chunks.values()),
      chunkIds: [...currentState.chunkIds],
      sourceOperation: operation,
    });

    return {
      state: finalState,
      addedChunks: allAddedChunks,
      removedChunkIds: allRemovedChunkIds,
    };
  }

  return applySingleOperationInternal(state, operation, pendingChunks);
}

/**
 * Apply a single operation to the state and persist to storage
 * @param state - The current state
 * @param operation - The operation to apply
 * @param context - Execution context containing pending chunks and storage
 * @returns The result of applying the operation
 */
export async function applyOperation(
  state: MemoryState,
  operation: Operation,
  context: ExecutionContext,
): Promise<ApplyResult> {
  const result = computeOperationResult(
    state,
    operation,
    context.pendingChunks,
  );

  // Persist in a transaction
  await context.storage.transaction(async (tx) => {
    if (result.addedChunks.length > 0) {
      await tx.saveChunks(result.addedChunks);
    }
    await tx.saveState(result.state);
  });

  return result;
}

/**
 * Apply multiple operations sequentially to the state and persist to storage
 * @param state - The current state
 * @param operations - The operations to apply
 * @param context - Execution context containing pending chunks and storage
 * @returns The final result after applying all operations
 */
export async function applyOperations(
  state: MemoryState,
  operations: Operation[],
  context: ExecutionContext,
): Promise<ApplyResult> {
  const originalStateId = state.id;
  let currentState = state;
  const allAddedChunks: MemoryChunk[] = [];
  const allRemovedChunkIds: string[] = [];

  for (const operation of operations) {
    const result = computeOperationResult(
      currentState,
      operation,
      context.pendingChunks,
    );
    currentState = result.state;
    allAddedChunks.push(...result.addedChunks);
    allRemovedChunkIds.push(...result.removedChunkIds);
  }

  // Create final state with correct previousStateId pointing to the original input state
  // This ensures the state chain is properly linked even when multiple operations are applied
  const finalState = deriveState(currentState, {
    chunks: Array.from(currentState.chunks.values()),
    chunkIds: [...currentState.chunkIds],
    sourceOperation: currentState.metadata.sourceOperation,
    custom: currentState.metadata.custom,
  });

  // Manually set the previousStateId to point to the original input state
  // We need to create the state with the correct previousStateId
  const correctedState = {
    ...finalState,
    metadata: {
      ...finalState.metadata,
      previousStateId: originalStateId,
    },
  } as Readonly<MemoryState>;

  // Persist in a transaction
  await context.storage.transaction(async (tx) => {
    if (allAddedChunks.length > 0) {
      await tx.saveChunks(allAddedChunks);
    }
    await tx.saveState(correctedState);
  });

  return {
    state: correctedState,
    addedChunks: allAddedChunks,
    removedChunkIds: allRemovedChunkIds,
  };
}

/**
 * Apply multiple operations with provenance tracking
 * Records the event, step, and operation that caused the state transition
 * @param state - The current state
 * @param operations - The operations to apply
 * @param context - Execution context containing pending chunks and storage
 * @param provenance - Provenance information for traceability
 * @param llmResponseRequirement - Event's requirement for LLM response
 * @returns The final result after applying all operations
 */
export async function applyOperationsWithProvenance(
  state: MemoryState,
  operations: Operation[],
  context: ExecutionContext,
  provenance: StateProvenance,
  llmResponseRequirement: LLMResponseRequirement,
): Promise<ApplyResult> {
  const originalStateId = state.id;
  let currentState = state;
  const allAddedChunks: MemoryChunk[] = [];
  const allRemovedChunkIds: string[] = [];

  for (const operation of operations) {
    const result = computeOperationResult(
      currentState,
      operation,
      context.pendingChunks,
    );
    currentState = result.state;
    allAddedChunks.push(...result.addedChunks);
    allRemovedChunkIds.push(...result.removedChunkIds);
  }

  // Calculate needLLMContinueResponse based on event's requirement
  const needLLMContinueResponse =
    llmResponseRequirement === 'need'
      ? true
      : llmResponseRequirement === 'no_need'
        ? false
        : state.needLLMContinueResponse; // 'keep' -> inherit from original state

  // Create final state with provenance information and needLLMContinueResponse
  const finalState = deriveState(currentState, {
    chunks: Array.from(currentState.chunks.values()),
    chunkIds: [...currentState.chunkIds],
    provenance: {
      ...provenance,
      timestamp: Date.now(),
    },
    needLLMContinueResponse,
  });

  // Correct the previousStateId to point to the original input state
  // This ensures the state chain is properly linked even when multiple operations are applied
  const correctedState = {
    ...finalState,
    metadata: {
      ...finalState.metadata,
      previousStateId: originalStateId,
    },
  } as Readonly<MemoryState>;

  // Persist in a transaction
  await context.storage.transaction(async (tx) => {
    if (allAddedChunks.length > 0) {
      await tx.saveChunks(allAddedChunks);
    }
    await tx.saveState(correctedState);
  });

  return {
    state: correctedState,
    addedChunks: allAddedChunks,
    removedChunkIds: allRemovedChunkIds,
  };
}

/**
 * Create an execution context
 * @param storage - Storage provider for persistence
 * @param chunks - Chunks to be added during operations
 * @returns An execution context
 */
export function createExecutionContext(
  storage: StorageProvider,
  chunks: MemoryChunk[] = [],
): ExecutionContext {
  const pendingChunks = new Map<string, MemoryChunk>();
  for (const chunk of chunks) {
    pendingChunks.set(chunk.id, chunk);
  }
  return { pendingChunks, storage };
}
