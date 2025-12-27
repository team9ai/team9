import {
  OperationType,
  AddOperation,
  UpdateOperation,
  DeleteOperation,
  ReorderOperation,
  ReplaceOperation,
  BatchReplaceOperation,
  BatchOperation,
  Operation,
} from '../types/operation.types';
import { generateOperationId } from '../utils/id.utils';

/**
 * Create an ADD operation
 */
export function createAddOperation(
  chunkId: string,
  position?: number,
): AddOperation {
  return {
    id: generateOperationId(),
    type: OperationType.ADD,
    timestamp: Date.now(),
    chunkId,
    position,
  };
}

/**
 * Create an UPDATE operation
 */
export function createUpdateOperation(
  targetChunkId: string,
  newChunkId: string,
): UpdateOperation {
  return {
    id: generateOperationId(),
    type: OperationType.UPDATE,
    timestamp: Date.now(),
    targetChunkId,
    newChunkId,
  };
}

/**
 * Create a DELETE operation
 */
export function createDeleteOperation(chunkId: string): DeleteOperation {
  return {
    id: generateOperationId(),
    type: OperationType.DELETE,
    timestamp: Date.now(),
    chunkId,
  };
}

/**
 * Create a REORDER operation
 */
export function createReorderOperation(
  chunkId: string,
  newPosition: number,
): ReorderOperation {
  return {
    id: generateOperationId(),
    type: OperationType.REORDER,
    timestamp: Date.now(),
    chunkId,
    newPosition,
  };
}

/**
 * Create a REPLACE operation
 */
export function createReplaceOperation(
  targetChunkId: string,
  newChunkId: string,
): ReplaceOperation {
  return {
    id: generateOperationId(),
    type: OperationType.REPLACE,
    timestamp: Date.now(),
    targetChunkId,
    newChunkId,
  };
}

/**
 * Create a BATCH_REPLACE operation
 */
export function createBatchReplaceOperation(
  targetChunkIds: string[],
  newChunkId: string,
): BatchReplaceOperation {
  return {
    id: generateOperationId(),
    type: OperationType.BATCH_REPLACE,
    timestamp: Date.now(),
    targetChunkIds,
    newChunkId,
  };
}

/**
 * Create a BATCH operation
 */
export function createBatchOperation(operations: Operation[]): BatchOperation {
  return {
    id: generateOperationId(),
    type: OperationType.BATCH,
    timestamp: Date.now(),
    operations,
  };
}
