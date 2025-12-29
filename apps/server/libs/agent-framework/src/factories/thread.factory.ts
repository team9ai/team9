import {
  MemoryThread,
  CreateThreadInput,
  ThreadMetadata,
  QueuedEvent,
} from '../types/thread.types.js';
import { generateThreadId } from '../utils/id.utils.js';

/**
 * Deep freeze an object to make it immutable
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
 * Create a new immutable Memory Thread
 * @param input - Optional input parameters
 * @returns A frozen MemoryThread object
 */
export function createThread(
  input?: CreateThreadInput,
): Readonly<MemoryThread> {
  const now = Date.now();

  const metadata: ThreadMetadata = {
    createdAt: now,
    updatedAt: now,
    custom: input?.custom,
  };

  const thread: MemoryThread = {
    id: generateThreadId(),
    currentStateId: undefined,
    initialStateId: undefined,
    metadata,
    eventQueue: [],
  };

  return deepFreeze(thread);
}

/**
 * Create an updated thread with new values
 * @param original - The original thread
 * @param updates - The updates to apply
 * @returns A new frozen MemoryThread object
 */
export function updateThread(
  original: MemoryThread,
  updates: {
    currentStateId?: string;
    initialStateId?: string;
    custom?: Record<string, unknown>;
    eventQueue?: QueuedEvent[];
    /** Current step ID for locking (use undefined to clear) */
    currentStepId?: string | undefined;
    /** Whether agent needs to generate a response */
    needsResponse?: boolean;
  },
): Readonly<MemoryThread> {
  const metadata: ThreadMetadata = {
    createdAt: original.metadata.createdAt,
    updatedAt: Date.now(),
    custom: updates.custom ?? original.metadata.custom,
  };

  const thread: MemoryThread = {
    id: original.id,
    currentStateId: updates.currentStateId ?? original.currentStateId,
    initialStateId: updates.initialStateId ?? original.initialStateId,
    metadata,
    eventQueue: updates.eventQueue ?? original.eventQueue ?? [],
    // Handle currentStepId: explicit undefined clears it, otherwise keep/update
    currentStepId:
      'currentStepId' in updates
        ? updates.currentStepId
        : original.currentStepId,
    // Handle needsResponse flag
    needsResponse:
      'needsResponse' in updates
        ? updates.needsResponse
        : original.needsResponse,
  };

  return deepFreeze(thread);
}
