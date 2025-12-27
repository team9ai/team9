import { MemoryState } from '../types/state.types.js';
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
 * Apply an operation to the state and persist to storage
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

  // Persist in a transaction
  await context.storage.transaction(async (tx) => {
    if (allAddedChunks.length > 0) {
      await tx.saveChunks(allAddedChunks);
    }
    await tx.saveState(currentState);
  });

  return {
    state: currentState,
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
