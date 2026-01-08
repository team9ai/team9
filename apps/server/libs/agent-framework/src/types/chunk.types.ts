import { Operation } from './operation.types.js';

/**
 * Chunk retention strategy
 * Determines how a Chunk is handled during memory compaction
 */
export enum ChunkRetentionStrategy {
  /** Must be retained, cannot be compressed */
  CRITICAL = 'CRITICAL',
  /** Can be compressed independently */
  COMPRESSIBLE = 'COMPRESSIBLE',
  /** Can be compressed as a whole batch */
  BATCH_COMPRESSIBLE = 'BATCH_COMPRESSIBLE',
  /** Can be discarded when needed */
  DISPOSABLE = 'DISPOSABLE',
  /** Should be discarded immediately after the current session ends */
  EPHEMERAL = 'EPHEMERAL',
}

/**
 * Chunk type
 * Defines different types of contextual information blocks
 */
export enum ChunkType {
  // ============ Core Types ============
  /** System-related contextual information */
  SYSTEM = 'SYSTEM',
  /** Agent's own contextual information */
  AGENT = 'AGENT',
  /** Agent workflow-related contextual information */
  WORKFLOW = 'WORKFLOW',
  /** Agent delegation-related contextual information */
  DELEGATION = 'DELEGATION',
  /** Current environment-related contextual information */
  ENVIRONMENT = 'ENVIRONMENT',
  /** Agent's working history - container that holds references to conversation chunks */
  WORKING_HISTORY = 'WORKING_HISTORY',
  /** Agent's final output result */
  OUTPUT = 'OUTPUT',

  // ============ Conversation Types (for conversation history) ============
  /** Summarized previously compressed contextual information */
  COMPACTED = 'COMPACTED',
  /** User message */
  USER_MESSAGE = 'USER_MESSAGE',
  /** Agent thinking process */
  THINKING = 'THINKING',
  /** Agent response */
  AGENT_RESPONSE = 'AGENT_RESPONSE',
  /** Agent action (tool call, skill call, etc.) */
  AGENT_ACTION = 'AGENT_ACTION',
  /** Response to agent action */
  ACTION_RESPONSE = 'ACTION_RESPONSE',
  /** Subagent spawn notification */
  SUBAGENT_SPAWN = 'SUBAGENT_SPAWN',
  /** Subagent result */
  SUBAGENT_RESULT = 'SUBAGENT_RESULT',
  /** Message from parent agent */
  PARENT_MESSAGE = 'PARENT_MESSAGE',
}

/**
 * Chunk content type
 */
export enum ChunkContentType {
  /** Plain text */
  TEXT = 'TEXT',
  /** Image */
  IMAGE = 'IMAGE',
  /** Mixed content (text and images) */
  MIXED = 'MIXED',
  /** Nested Chunk reference */
  CHUNK_REF = 'CHUNK_REF',
}

/**
 * Text content
 */
export interface TextContent {
  type: ChunkContentType.TEXT;
  text: string;
}

/**
 * Image content
 */
export interface ImageContent {
  type: ChunkContentType.IMAGE;
  /** Base64 encoded image data or URL */
  data: string;
  /** Image MIME type */
  mimeType: string;
  /** Optional alternative text */
  altText?: string;
}

/**
 * Mixed content
 */
export interface MixedContent {
  type: ChunkContentType.MIXED;
  parts: Array<TextContent | ImageContent>;
}

/**
 * Chunk reference content
 */
export interface ChunkRefContent {
  type: ChunkContentType.CHUNK_REF;
  /** Referenced Chunk ID */
  chunkId: string;
}

/**
 * Structured content for flexible data storage
 */
export interface StructuredContent {
  type: ChunkContentType;
  /** Flexible data storage */
  [key: string]: unknown;
}

/**
 * Chunk content union type
 */
export type ChunkContent =
  | TextContent
  | ImageContent
  | MixedContent
  | ChunkRefContent
  | StructuredContent;

/**
 * Chunk priority
 * Higher values indicate higher priority
 */
export type ChunkPriority = number;

/**
 * Memory Chunk metadata
 */
export interface ChunkMetadata {
  /** Creation timestamp */
  createdAt: number;
  /** Parent Chunk IDs (for compacted/modified chunks, may have multiple parents) */
  parentIds?: string[];
  /** The operation that created this Chunk */
  sourceOperation?: Operation;
  /** Custom metadata */
  custom?: Record<string, unknown>;
}

/**
 * Memory Chunk interface
 * Represents an independent logical block of contextual information
 * Once used, a Chunk becomes immutable; new information generates a new Chunk
 */
export interface MemoryChunk {
  /** Unique identifier, format: chunk_xxx */
  id: string;
  /** Component ID that owns this chunk (optional, some chunks may not belong to a component) */
  componentId?: string;
  /** Chunk key within the component (identifies the chunk's purpose) */
  chunkKey?: string;
  /** Chunk type */
  type: ChunkType;
  /** Chunk content */
  content: ChunkContent;
  /** Child chunk IDs (for WORKING_HISTORY container - references to independent chunks) */
  childIds?: string[];
  /** Retention strategy */
  retentionStrategy: ChunkRetentionStrategy;
  /** Whether this Chunk can be modified by Agent in current Thread */
  mutable: boolean;
  /** Priority */
  priority: ChunkPriority;
  /** Metadata */
  metadata: ChunkMetadata;
}

/**
 * Input parameters for creating a Memory Chunk
 */
export interface CreateChunkInput {
  /** Component ID that owns this chunk */
  componentId?: string;
  /** Chunk key within the component */
  chunkKey?: string;
  type: ChunkType;
  content: ChunkContent;
  retentionStrategy?: ChunkRetentionStrategy;
  mutable?: boolean;
  priority?: ChunkPriority;
  parentIds?: string[];
  sourceOperation?: Operation;
  custom?: Record<string, unknown>;
}
