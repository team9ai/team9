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
  /** Agent's current working flow contextual information */
  WORKING_FLOW = 'WORKING_FLOW',
  /** Agent's final output result */
  OUTPUT = 'OUTPUT',
}

/**
 * Working Flow Chunk subtypes
 */
export enum WorkingFlowSubType {
  /** Summarized previously compressed contextual information */
  COMPACTED = 'COMPACTED',
  /** User interjections, interventions, and reply guidance */
  USER = 'USER',
  /** Agent thinking process related context */
  THINKING = 'THINKING',
  /** Intermediate process responses from the agent model */
  RESPONSE = 'RESPONSE',
  /** Actions from Agent calling MCP, Skill, SubAgent, etc. */
  AGENT_ACTION = 'AGENT_ACTION',
  /** Response to Agent Action */
  ACTION_RESPONSE = 'ACTION_RESPONSE',
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
 * Working Flow child item
 * Represents a single message (user or agent) within a WORKING_FLOW chunk
 */
export interface WorkingFlowChild {
  /** Child unique identifier */
  id: string;
  /** Child subtype */
  subType: WorkingFlowSubType;
  /** Content */
  content: ChunkContent;
  /** Creation timestamp */
  createdAt: number;
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
  /** Chunk type */
  type: ChunkType;
  /** Working Flow subtype (only valid when type is WORKING_FLOW and no children) */
  subType?: WorkingFlowSubType;
  /** Chunk content */
  content: ChunkContent;
  /** Child items (for WORKING_FLOW container chunks) */
  children?: WorkingFlowChild[];
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
  type: ChunkType;
  subType?: WorkingFlowSubType;
  content: ChunkContent;
  retentionStrategy?: ChunkRetentionStrategy;
  mutable?: boolean;
  priority?: ChunkPriority;
  parentIds?: string[];
  sourceOperation?: Operation;
  custom?: Record<string, unknown>;
}
