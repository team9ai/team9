/**
 * Working History Compactor
 * Compaction operations for working history management
 */

import type { MemoryChunk } from '../../../types/chunk.types.js';
import {
  ChunkType,
  ChunkContentType,
  ChunkRetentionStrategy,
} from '../../../types/chunk.types.js';
import type { MemoryState } from '../../../types/state.types.js';
import type { ReducerResult } from '../../../reducer/reducer.types.js';
import { createChunk } from '../../../factories/chunk.factory.js';
import { createBatchReplaceOperation } from '../../../factories/operation.factory.js';
import type {
  ILLMAdapter,
  LLMCompletionResponse,
} from '../../../llm/llm.types.js';
import type {
  CompactionResult,
  CompactionConfig,
} from './working-history.types.js';
import { findWorkingHistoryChunk } from './working-history.operations.js';

/**
 * Conversation chunk types that can be compacted
 */
const CONVERSATION_CHUNK_TYPES = [
  ChunkType.USER_MESSAGE,
  ChunkType.AGENT_RESPONSE,
  ChunkType.THINKING,
  ChunkType.AGENT_ACTION,
  ChunkType.ACTION_RESPONSE,
  ChunkType.SUBAGENT_SPAWN,
  ChunkType.SUBAGENT_RESULT,
  ChunkType.PARENT_MESSAGE,
  ChunkType.COMPACTED,
];

/**
 * Prompt template for working history compaction
 */
const COMPACTION_PROMPT = `
You are a context compression assistant. Your task is to condense a working history log into a concise summary that preserves critical knowledge for continuing the task.

<retained_content>
The following content will be RETAINED in memory and will NOT be compressed. Do NOT repeat information that already exists here:
{{RETAINED_CONTENT}}
</retained_content>

<context>
{{CONTEXT}}
</context>

<working_history_to_compact>
The following working history will be compressed. Focus on capturing NEW information not already in retained content:
{{WORKING_HISTORY}}
</working_history_to_compact>

<instructions>
Create a summary of the working history, following these guidelines:

1. **What has been done**: List significant actions taken
2. **What has been tried**: Note methods or approaches that were attempted
3. **What has failed**: Identify strategies or actions that did not yield results
4. **What has worked**: Highlight successful methods or solutions
5. **Current objective**: State the main goal of the task
6. **Next steps**: Outline immediate actions needed
7. **Where we left off**: Summarize the last point of progress
8. **Files/resources touched**: List relevant files or resources mentioned
9. **Key decisions**: Document important decisions and their reasoning

Critical rules:
- Do NOT repeat information already present in <retained_content>
- If progress/decisions are already documented in retained content, skip them
- Focus on NEW information that is not captured elsewhere
- Remove duplications and redundant information
- Remove verbose log outputs and technical noise
- Preserve file paths and code snippets that may be relevant
- Keep error messages that are still relevant
- Be concise but comprehensive
- Use bullet points for clarity
- Do NOT include these instructions in your output
</instructions>

<output_format>
Provide your summary in the following format:

## Progress Summary

### Completed Actions
- [List of completed actions not already in retained content]

### Attempted Approaches
- [What was tried, noting success/failure]

### Current State
[Brief description of where we are]

### Key Information
- [Important details, file paths, decisions not already retained]

### Next Steps
- [What needs to be done next]
</output_format>`;

/**
 * Check if a chunk is compressible (non-CRITICAL conversation chunk)
 */
export function isCompressibleChunk(chunk: MemoryChunk): boolean {
  return (
    CONVERSATION_CHUNK_TYPES.includes(chunk.type) &&
    (chunk.retentionStrategy === ChunkRetentionStrategy.COMPRESSIBLE ||
      chunk.retentionStrategy === ChunkRetentionStrategy.BATCH_COMPRESSIBLE ||
      chunk.retentionStrategy === ChunkRetentionStrategy.DISPOSABLE)
  );
}

/**
 * Check if there are any compressible chunks in the working history
 */
export function hasCompressibleChunks(state: MemoryState): boolean {
  const workingHistoryChunk = findWorkingHistoryChunk(state);
  if (!workingHistoryChunk) return false;

  const childIds = workingHistoryChunk.childIds ?? [];
  for (const childId of childIds) {
    const chunk = state.chunks.get(childId);
    if (chunk && isCompressibleChunk(chunk)) {
      return true;
    }
  }
  return false;
}

/**
 * Options for checking if compaction should be triggered
 */
export interface CompactionTriggerOptions {
  /** Token threshold to trigger compaction (default: 50000) */
  tokenThreshold?: number;
  /** Minimum number of compressible chunks to trigger (default: 3) */
  minChunkCount?: number;
}

/**
 * Check if compaction should be triggered for the working history.
 * This is the primary decision function for whether to compact.
 *
 * @param state - Memory state
 * @param options - Trigger options
 * @returns true if compaction should be triggered
 */
export function shouldTriggerCompaction(
  state: MemoryState,
  options: CompactionTriggerOptions = {},
): boolean {
  const { tokenThreshold = 50000, minChunkCount = 3 } = options;

  const workingHistoryChunk = findWorkingHistoryChunk(state);
  if (!workingHistoryChunk) return false;

  const childIds = workingHistoryChunk.childIds ?? [];
  let compressibleCount = 0;
  let estimatedTokens = 0;

  for (const childId of childIds) {
    const chunk = state.chunks.get(childId);
    if (chunk && isCompressibleChunk(chunk)) {
      compressibleCount++;
      // Rough token estimate: ~4 chars per token
      estimatedTokens += Math.ceil(extractChunkText(chunk).length / 4);
    }
  }

  // Trigger if we have enough compressible chunks AND exceed token threshold
  return (
    compressibleCount >= minChunkCount && estimatedTokens >= tokenThreshold
  );
}

/**
 * Get CRITICAL chunks from state that will be retained (not compressed).
 * These are conversation-type chunks that the AI should be aware of
 * to avoid duplicating information in the summary.
 */
export function getRetainedChunks(state: MemoryState): MemoryChunk[] {
  return Array.from(state.chunks.values()).filter(
    (chunk) =>
      CONVERSATION_CHUNK_TYPES.includes(chunk.type) &&
      chunk.retentionStrategy === ChunkRetentionStrategy.CRITICAL,
  );
}

/**
 * Extract text content from a chunk
 */
export function extractChunkText(chunk: MemoryChunk): string {
  const content = chunk.content;

  if (content.type === ChunkContentType.TEXT) {
    if ('text' in content && typeof content.text === 'string') {
      return content.text;
    }
    const { type, ...rest } = content;
    return JSON.stringify(rest, null, 2);
  }

  if (content.type === ChunkContentType.MIXED && 'parts' in content) {
    const parts = content.parts as Array<{
      type: ChunkContentType;
      text?: string;
    }>;
    return parts
      .filter((p) => p.type === ChunkContentType.TEXT)
      .map((p) => p.text ?? '')
      .join('\n');
  }

  try {
    const { type, ...rest } = content;
    return JSON.stringify(rest, null, 2);
  } catch {
    return '[Non-text content]';
  }
}

/**
 * Build retained content section for the prompt
 */
function buildRetainedContentSection(retainedChunks: MemoryChunk[]): string {
  if (retainedChunks.length === 0) {
    return 'No retained content.';
  }

  return retainedChunks
    .map((chunk, index) => {
      const chunkType = chunk.type;
      const content = extractChunkText(chunk);
      return `<retained_entry index="${index + 1}" type="${chunkType}">\n${content}\n</retained_entry>`;
    })
    .join('\n\n');
}

/**
 * Build context section for the prompt
 */
function buildContextSection(
  state: MemoryState,
  taskGoal?: string,
  progressSummary?: string,
): string {
  const parts: string[] = [];

  if (taskGoal) {
    parts.push(`<task_goal>${taskGoal}</task_goal>`);
  }

  if (progressSummary) {
    parts.push(`<progress_summary>${progressSummary}</progress_summary>`);
  }

  // Extract system chunks for context
  const systemChunks = Array.from(state.chunks.values()).filter(
    (c) => c.type === ChunkType.SYSTEM,
  );
  if (systemChunks.length > 0) {
    const systemInfo = systemChunks
      .map((c) => extractChunkText(c))
      .filter(Boolean)
      .join('\n');
    if (systemInfo) {
      parts.push(`<system_context>${systemInfo}</system_context>`);
    }
  }

  return parts.length > 0
    ? parts.join('\n\n')
    : 'No additional context available.';
}

/**
 * Build working history section from chunks
 */
function buildWorkingHistorySection(chunks: MemoryChunk[]): string {
  return chunks
    .map((chunk, index) => {
      const chunkType = chunk.type;
      const timestamp = chunk.metadata.createdAt;
      const content = extractChunkText(chunk);
      const custom = chunk.metadata.custom;

      let entry = `<entry index="${index + 1}" type="${chunkType}" timestamp="${timestamp}">`;

      // Add custom metadata if present
      if (custom) {
        const relevantMeta = Object.entries(custom)
          .filter(([key]) => !['eventType', 'timestamp'].includes(key))
          .map(([key, value]) => `${key}="${value}"`)
          .join(' ');
        if (relevantMeta) {
          entry = `<entry index="${index + 1}" type="${chunkType}" timestamp="${timestamp}" ${relevantMeta}>`;
        }
      }

      entry += `\n${content}\n</entry>`;
      return entry;
    })
    .join('\n\n');
}

/**
 * Extract task goal from state
 */
function extractTaskGoal(state: MemoryState): string | undefined {
  for (const chunk of state.chunks.values()) {
    if (
      chunk.type === ChunkType.SYSTEM ||
      chunk.type === ChunkType.DELEGATION
    ) {
      const content = chunk.content;
      if ('task' in content && typeof content.task === 'string') {
        return content.task;
      }
      if ('taskContext' in content && content.taskContext) {
        const ctx = content.taskContext as Record<string, unknown>;
        if ('goal' in ctx && typeof ctx.goal === 'string') {
          return ctx.goal;
        }
      }
    }
  }
  return undefined;
}

/**
 * Extract progress summary from state
 */
function extractProgressSummary(state: MemoryState): string | undefined {
  for (const chunk of state.chunks.values()) {
    if (chunk.type === ChunkType.COMPACTED) {
      const content = chunk.content;
      if ('text' in content && typeof content.text === 'string') {
        return content.text;
      }
    }
  }
  return undefined;
}

/**
 * Estimate token count (rough approximation: ~4 characters per token)
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Compact working history chunks using LLM
 *
 * @param state - Memory state containing chunks
 * @param llmAdapter - LLM adapter for generating summary
 * @param config - Compaction configuration
 * @returns Compaction result with compacted chunk
 */
export async function compactWorkingHistory(
  state: MemoryState,
  llmAdapter: ILLMAdapter,
  config: CompactionConfig = {},
): Promise<CompactionResult> {
  // Find the WORKING_HISTORY chunk
  const workingHistoryChunk = findWorkingHistoryChunk(state);

  if (!workingHistoryChunk) {
    throw new Error('No WORKING_HISTORY chunk found in state');
  }

  // Get all child chunks from WORKING_HISTORY
  const childIds = workingHistoryChunk.childIds ?? [];
  const allHistoryChunks: MemoryChunk[] = [];

  for (const childId of childIds) {
    const chunk = state.chunks.get(childId);
    if (chunk) {
      allHistoryChunks.push(chunk);
    }
  }

  // Check if there are any compressible chunks
  const hasCompressible = allHistoryChunks.some((chunk) =>
    isCompressibleChunk(chunk),
  );
  if (!hasCompressible) {
    throw new Error('No compressible chunks found in WORKING_HISTORY');
  }

  // Filter to only compressible chunks
  const compressibleChunks = allHistoryChunks.filter((chunk) =>
    isCompressibleChunk(chunk),
  );

  // Get retained chunks from state (CRITICAL conversation chunks)
  const retainedChunks = getRetainedChunks(state);

  // Build prompt sections
  const retainedContentSection = buildRetainedContentSection(retainedChunks);
  const taskGoal = extractTaskGoal(state);
  const progressSummary = extractProgressSummary(state);
  const contextSection = buildContextSection(state, taskGoal, progressSummary);
  const workingHistorySection = buildWorkingHistorySection(compressibleChunks);

  // Generate prompt
  const prompt = COMPACTION_PROMPT.replace(
    '{{RETAINED_CONTENT}}',
    retainedContentSection,
  )
    .replace('{{CONTEXT}}', contextSection)
    .replace('{{WORKING_HISTORY}}', workingHistorySection);

  // Call LLM
  const response: LLMCompletionResponse = await llmAdapter.complete({
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: config.temperature ?? 0.3,
    maxTokens: config.maxTokens ?? 2000,
  });

  // Create compacted chunk
  const compactedChunk = createChunk({
    type: ChunkType.COMPACTED,
    content: {
      type: ChunkContentType.TEXT,
      text: response.content,
    },
    retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
    parentIds: compressibleChunks.map((c) => c.id),
    custom: {
      compactedAt: Date.now(),
      originalChunkCount: compressibleChunks.length,
      tokensUsed: response.usage,
    },
  });

  return {
    compactedChunk,
    originalChunkIds: compressibleChunks.map((c) => c.id),
    tokensBefore: estimateTokens(workingHistorySection),
    tokensAfter: estimateTokens(response.content),
  };
}

/**
 * Create reducer result for applying compaction to state
 */
export function createCompactionResult(
  compactionResult: CompactionResult,
): ReducerResult {
  return {
    operations: [
      createBatchReplaceOperation(
        compactionResult.originalChunkIds,
        compactionResult.compactedChunk.id,
      ),
    ],
    chunks: [compactionResult.compactedChunk],
  };
}
