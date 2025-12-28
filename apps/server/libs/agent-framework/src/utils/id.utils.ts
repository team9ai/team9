import { createId } from '@paralleldrive/cuid2';

/**
 * ID prefix types
 */
export enum IdPrefix {
  CHUNK = 'chunk',
  CHILD = 'child',
  STATE = 'state',
  THREAD = 'thread',
  OPERATION = 'op',
  SNAPSHOT = 'snapshot',
  QUEUED_EVENT = 'qevt',
  STEP = 'step',
}

/**
 * Generate a random ID with the specified prefix
 * Format: {prefix}_{cuid}
 * @param prefix - The prefix for the ID
 * @returns A unique ID string
 */
export function generateId(prefix: IdPrefix): string {
  return `${prefix}_${createId()}`;
}

/**
 * Generate a Chunk ID
 * @returns A unique Chunk ID (format: chunk_xxx)
 */
export function generateChunkId(): string {
  return generateId(IdPrefix.CHUNK);
}

/**
 * Generate a Child ID
 * @returns A unique Child ID (format: child_xxx)
 */
export function generateChildId(): string {
  return generateId(IdPrefix.CHILD);
}

/**
 * Generate a State ID
 * @returns A unique State ID (format: state_xxx)
 */
export function generateStateId(): string {
  return generateId(IdPrefix.STATE);
}

/**
 * Generate a Thread ID
 * @returns A unique Thread ID (format: thread_xxx)
 */
export function generateThreadId(): string {
  return generateId(IdPrefix.THREAD);
}

/**
 * Generate an Operation ID
 * @returns A unique Operation ID (format: op_xxx)
 */
export function generateOperationId(): string {
  return generateId(IdPrefix.OPERATION);
}

/**
 * Generate a Queued Event ID
 * @returns A unique Queued Event ID (format: qevt_xxx)
 */
export function generateQueuedEventId(): string {
  return generateId(IdPrefix.QUEUED_EVENT);
}

/**
 * Generate a Step ID
 * @returns A unique Step ID (format: step_xxx)
 */
export function generateStepId(): string {
  return generateId(IdPrefix.STEP);
}

/**
 * Extract the prefix from an ID
 * @param id - The ID to extract prefix from
 * @returns The prefix or null if invalid
 */
export function extractIdPrefix(id: string): IdPrefix | null {
  if (!id || typeof id !== 'string') {
    return null;
  }
  const parts = id.split('_');
  if (parts.length < 2) {
    return null;
  }
  const prefix = parts[0] as IdPrefix;
  if (Object.values(IdPrefix).includes(prefix)) {
    return prefix;
  }
  return null;
}
