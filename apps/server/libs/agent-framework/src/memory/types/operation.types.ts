/**
 * Operation type
 * Defines the types of operations that can be performed on Memory State
 */
export enum OperationType {
  /** Add a new Chunk */
  ADD = 'ADD',
  /** Update an existing Chunk (creates new Chunk with parent reference) */
  UPDATE = 'UPDATE',
  /** Delete a Chunk */
  DELETE = 'DELETE',
  /** Reorder Chunks */
  REORDER = 'REORDER',
  /** Replace a Chunk with another */
  REPLACE = 'REPLACE',
  /** Batch replace multiple Chunks into one */
  BATCH_REPLACE = 'BATCH_REPLACE',
  /** Batch operation containing multiple operations */
  BATCH = 'BATCH',
}

/**
 * Base operation interface
 */
export interface BaseOperation {
  /** Unique identifier, format: op_xxx */
  id: string;
  /** Operation type */
  type: OperationType;
  /** Timestamp when the operation was created */
  timestamp: number;
}

/**
 * Add operation - adds a new Chunk to the state
 */
export interface AddOperation extends BaseOperation {
  type: OperationType.ADD;
  /** The Chunk ID to add */
  chunkId: string;
  /** Optional position to insert at (defaults to end) */
  position?: number;
}

/**
 * Update operation - updates an existing Chunk (creates new Chunk)
 */
export interface UpdateOperation extends BaseOperation {
  type: OperationType.UPDATE;
  /** The original Chunk ID being updated */
  targetChunkId: string;
  /** The new Chunk ID that replaces it */
  newChunkId: string;
}

/**
 * Delete operation - removes a Chunk from the state
 */
export interface DeleteOperation extends BaseOperation {
  type: OperationType.DELETE;
  /** The Chunk ID to delete */
  chunkId: string;
}

/**
 * Reorder operation - changes the order of Chunks
 */
export interface ReorderOperation extends BaseOperation {
  type: OperationType.REORDER;
  /** The Chunk ID to move */
  chunkId: string;
  /** The new position index */
  newPosition: number;
}

/**
 * Replace operation - replaces one Chunk with another
 */
export interface ReplaceOperation extends BaseOperation {
  type: OperationType.REPLACE;
  /** The Chunk ID to replace */
  targetChunkId: string;
  /** The new Chunk ID */
  newChunkId: string;
}

/**
 * Batch replace operation - replaces multiple Chunks with one
 */
export interface BatchReplaceOperation extends BaseOperation {
  type: OperationType.BATCH_REPLACE;
  /** The Chunk IDs to replace */
  targetChunkIds: string[];
  /** The new Chunk ID that replaces them */
  newChunkId: string;
}

/**
 * Batch operation - contains multiple nested operations
 */
export interface BatchOperation extends BaseOperation {
  type: OperationType.BATCH;
  /** Nested operations to execute as a batch */
  operations: Operation[];
}

/**
 * Union type of all operations
 */
export type Operation =
  | AddOperation
  | UpdateOperation
  | DeleteOperation
  | ReorderOperation
  | ReplaceOperation
  | BatchReplaceOperation
  | BatchOperation;
