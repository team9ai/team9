/**
 * Memory Component Types
 * Type definitions for memory management
 */

import type { BaseEvent } from '../../../types/base-event.types.js';

// ============ Event Types ============

/**
 * Memory event type enum values for this component
 */
export const MemoryEventType = {
  MEMORY_MARK_CRITICAL: 'MEMORY_MARK_CRITICAL',
  MEMORY_FORGET: 'MEMORY_FORGET',
  MEMORY_COMPACT_MANUAL: 'MEMORY_COMPACT_MANUAL',
  MEMORY_COMPACT_AUTO: 'MEMORY_COMPACT_AUTO',
} as const;

export type MemoryEventTypeValue =
  (typeof MemoryEventType)[keyof typeof MemoryEventType];

// ============ Event Interfaces ============

export interface MemoryMarkCriticalEvent extends BaseEvent<
  typeof MemoryEventType.MEMORY_MARK_CRITICAL
> {
  /** IDs of the chunks to mark as critical */
  chunkIds: string[];
  /** Reason for marking as critical */
  reason?: string;
}

export interface MemoryForgetEvent extends BaseEvent<
  typeof MemoryEventType.MEMORY_FORGET
> {
  /** IDs of the chunks to forget */
  chunkIds: string[];
  /** Reason for forgetting */
  reason?: string;
}

export interface MemoryCompactManualEvent extends BaseEvent<
  typeof MemoryEventType.MEMORY_COMPACT_MANUAL
> {
  /** Target chunks to compact (optional, all if not specified) */
  targetChunkIds?: string[];
  /** Reason for manual compaction */
  reason?: string;
}

export interface MemoryCompactAutoEvent extends BaseEvent<
  typeof MemoryEventType.MEMORY_COMPACT_AUTO
> {
  /** Trigger reason (e.g., token limit, turn count) */
  trigger: string;
  /** Target chunks to compact */
  targetChunkIds?: string[];
}

/** Union of all memory events */
export type MemoryEvent =
  | MemoryMarkCriticalEvent
  | MemoryForgetEvent
  | MemoryCompactManualEvent
  | MemoryCompactAutoEvent;

// ============ Component Types ============

/**
 * Memory statistics
 */
export interface MemoryStats {
  totalChunks: number;
  criticalChunks: number;
  forgottenChunks: number;
  compressibleChunks: number;
}
