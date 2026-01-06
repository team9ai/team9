/**
 * Context Inheritance Utilities
 *
 * Provides functions for extracting and inheriting context from parent threads
 * when spawning subagents.
 */

import type { MemoryState } from '../types/state.types.js';
import type { MemoryChunk, WorkingFlowChild } from '../types/chunk.types.js';
import { ChunkType, ChunkContentType } from '../types/chunk.types.js';

/**
 * Options for extracting working flow chunks
 */
export interface ExtractWorkingFlowOptions {
  /** Maximum number of chunks to extract (default: all) */
  maxChunks?: number;
  /** Whether to include children in the extraction (default: true) */
  includeChildren?: boolean;
}

/**
 * Extract WORKING_FLOW type chunks from a memory state
 * These chunks contain the conversation history and working context
 *
 * @param state - The memory state to extract from
 * @param chunks - Map of chunk IDs to chunks
 * @param options - Extraction options
 * @returns Array of WORKING_FLOW chunks
 */
export function extractWorkingFlowChunks(
  state: MemoryState,
  chunks: Map<string, MemoryChunk>,
  options?: ExtractWorkingFlowOptions,
): MemoryChunk[] {
  const workingFlowChunks: MemoryChunk[] = [];

  for (const chunkId of state.chunkIds) {
    const chunk = chunks.get(chunkId);
    if (chunk && chunk.type === ChunkType.WORKING_FLOW) {
      workingFlowChunks.push(chunk);
    }
  }

  // Apply max limit if specified
  if (options?.maxChunks && workingFlowChunks.length > options.maxChunks) {
    // Keep the most recent chunks
    return workingFlowChunks.slice(-options.maxChunks);
  }

  return workingFlowChunks;
}

/**
 * Result of building inherited context
 */
export interface InheritedContextResult {
  /** Chunks to include in the subagent's initial state */
  chunks: MemoryChunk[];
  /** Summary of the inherited context for the subagent */
  contextSummary: string;
}

/**
 * Build inherited context for a subagent from parent state
 *
 * This function extracts the relevant context from the parent thread
 * and prepares it for the subagent's initial state.
 *
 * @param parentState - The parent thread's current state
 * @param parentChunks - Map of parent chunk IDs to chunks
 * @param options - Extraction options
 * @returns Inherited context result
 */
export function buildInheritedContext(
  parentState: MemoryState,
  parentChunks: Map<string, MemoryChunk>,
  options?: ExtractWorkingFlowOptions,
): InheritedContextResult {
  // Extract WORKING_FLOW chunks from parent
  const workingFlowChunks = extractWorkingFlowChunks(
    parentState,
    parentChunks,
    options,
  );

  // Build a summary of the context
  const contextParts: string[] = [];

  for (const chunk of workingFlowChunks) {
    // Handle container chunks with children
    if (chunk.children && chunk.children.length > 0) {
      for (const child of chunk.children) {
        const text = extractTextFromContent(child.content);
        if (text) {
          contextParts.push(`[${child.subType}] ${text}`);
        }
      }
    } else {
      // Handle leaf chunks
      const text = extractTextFromContent(chunk.content);
      if (text) {
        const prefix = chunk.subType ? `[${chunk.subType}] ` : '';
        contextParts.push(`${prefix}${text}`);
      }
    }
  }

  return {
    chunks: workingFlowChunks,
    contextSummary: contextParts.join('\n'),
  };
}

/**
 * Extract text content from a chunk content
 *
 * @param content - The chunk content
 * @returns Extracted text or empty string
 */
function extractTextFromContent(content: MemoryChunk['content']): string {
  if (content.type === ChunkContentType.TEXT) {
    return (content as { type: ChunkContentType.TEXT; text: string }).text;
  }

  if (content.type === ChunkContentType.MIXED) {
    const mixed = content as {
      type: ChunkContentType.MIXED;
      parts: Array<{ type: ChunkContentType; text?: string }>;
    };
    return mixed.parts
      .filter((part) => part.type === ChunkContentType.TEXT && part.text)
      .map((part) => part.text!)
      .join(' ');
  }

  // For structured content, try to extract text field
  if ('text' in content && typeof content.text === 'string') {
    return content.text;
  }

  return '';
}

/**
 * Create a context summary chunk for the subagent
 * This provides the subagent with a concise overview of the parent's context
 *
 * @param parentContext - The inherited context result
 * @param task - The task assigned to the subagent
 * @returns A summary string for the subagent's system context
 */
export function createSubagentContextSummary(
  parentContext: InheritedContextResult,
  task: string,
): string {
  const lines: string[] = [
    '## Parent Agent Context',
    '',
    'You are a subagent spawned to handle a specific task.',
    'Below is the relevant context from the parent agent:',
    '',
    '---',
    parentContext.contextSummary || '(No prior context)',
    '---',
    '',
    '## Your Task',
    '',
    task,
  ];

  return lines.join('\n');
}
