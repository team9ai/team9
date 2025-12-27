import {
  MemoryChunk,
  ChunkType,
  ChunkRetentionStrategy,
  ChunkContentType,
  WorkingFlowSubType,
} from '../types/chunk.types';
import { createChunk } from '../factories/chunk.factory';
import { ILLMAdapter, LLMConfig } from '../llm/llm.types';
import {
  ICompactor,
  CompactionResult,
  CompactionContext,
} from './compactor.types';

/**
 * Prompt template for working flow compaction
 */
const COMPACTION_PROMPT = `You are a context compression assistant. Your task is to condense a working flow log into a concise summary that preserves all critical knowledge for continuing the task.

<context>
{{CONTEXT}}
</context>

<working_flow_to_compact>
{{WORKING_FLOW}}
</working_flow_to_compact>

<instructions>
Analyze the working flow above and create a comprehensive summary following these guidelines:

1. **What has been done**: List all significant actions taken
2. **What has been tried**: Note methods or approaches that were attempted
3. **What has failed**: Identify strategies or actions that did not yield results
4. **What has worked**: Highlight successful methods or solutions
5. **Current objective**: State the main goal of the task
6. **Next steps**: Outline immediate actions needed
7. **Where we left off**: Summarize the last point of progress
8. **Files/resources touched**: List all relevant files or resources mentioned
9. **Key decisions**: Document important decisions and their reasoning

Rules:
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
- [List of completed actions]

### Attempted Approaches
- [What was tried, noting success/failure]

### Current State
[Brief description of where we are]

### Key Information
- [Important details, file paths, decisions]

### Next Steps
- [What needs to be done next]
</output_format>`;

/**
 * WorkingFlowCompactor compresses WORKING_FLOW chunks
 * Uses LLM to generate intelligent summaries
 */
export class WorkingFlowCompactor implements ICompactor {
  constructor(
    private llmAdapter: ILLMAdapter,
    private config: LLMConfig,
  ) {}

  /**
   * Check if chunks can be compacted by this compactor
   * Only handles WORKING_FLOW chunks that are COMPRESSIBLE or BATCH_COMPRESSIBLE
   */
  canCompact(chunks: MemoryChunk[]): boolean {
    if (chunks.length === 0) return false;

    return chunks.every(
      (chunk) =>
        chunk.type === ChunkType.WORKING_FLOW &&
        (chunk.retentionStrategy === ChunkRetentionStrategy.COMPRESSIBLE ||
          chunk.retentionStrategy ===
            ChunkRetentionStrategy.BATCH_COMPRESSIBLE ||
          chunk.retentionStrategy === ChunkRetentionStrategy.DISPOSABLE),
    );
  }

  /**
   * Compact working flow chunks into a summary
   */
  async compact(
    chunks: MemoryChunk[],
    context: CompactionContext,
  ): Promise<CompactionResult> {
    if (!this.canCompact(chunks)) {
      throw new Error('WorkingFlowCompactor cannot compact these chunks');
    }

    // Build context section
    const contextSection = this.buildContextSection(context);

    // Build working flow section
    const workingFlowSection = this.buildWorkingFlowSection(chunks);

    // Generate prompt
    const prompt = COMPACTION_PROMPT.replace(
      '{{CONTEXT}}',
      contextSection,
    ).replace('{{WORKING_FLOW}}', workingFlowSection);

    // Call LLM
    const response = await this.llmAdapter.complete({
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: this.config.temperature ?? 0.3,
      maxTokens: this.config.maxTokens ?? 2000,
    });

    // Create compacted chunk
    const compactedChunk = createChunk({
      type: ChunkType.WORKING_FLOW,
      subType: WorkingFlowSubType.COMPACTED,
      content: {
        type: ChunkContentType.TEXT,
        text: response.content,
      },
      retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      parentIds: chunks.map((c) => c.id),
      custom: {
        compactedAt: Date.now(),
        originalChunkCount: chunks.length,
        tokensUsed: response.usage,
      },
    });

    return {
      compactedChunk,
      originalChunkIds: chunks.map((c) => c.id),
      tokensBefore: this.estimateTokens(workingFlowSection),
      tokensAfter: this.estimateTokens(response.content),
    };
  }

  /**
   * Build context section for the prompt
   */
  private buildContextSection(context: CompactionContext): string {
    const parts: string[] = [];

    if (context.taskGoal) {
      parts.push(`<task_goal>${context.taskGoal}</task_goal>`);
    }

    if (context.progressSummary) {
      parts.push(
        `<progress_summary>${context.progressSummary}</progress_summary>`,
      );
    }

    // Extract system chunks for context
    const systemChunks = Array.from(context.state.chunks.values()).filter(
      (c) => c.type === ChunkType.SYSTEM,
    );
    if (systemChunks.length > 0) {
      const systemInfo = systemChunks
        .map((c) => this.extractChunkText(c))
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
   * Build working flow section from chunks
   */
  private buildWorkingFlowSection(chunks: MemoryChunk[]): string {
    return chunks
      .map((chunk, index) => {
        const subType = chunk.subType || 'UNKNOWN';
        const timestamp = chunk.metadata.createdAt;
        const content = this.extractChunkText(chunk);
        const custom = chunk.metadata.custom;

        let entry = `<entry index="${index + 1}" subtype="${subType}" timestamp="${timestamp}">`;

        // Add custom metadata if present
        if (custom) {
          const relevantMeta = Object.entries(custom)
            .filter(([key]) => !['eventType', 'timestamp'].includes(key))
            .map(([key, value]) => `${key}="${value}"`)
            .join(' ');
          if (relevantMeta) {
            entry = `<entry index="${index + 1}" subtype="${subType}" timestamp="${timestamp}" ${relevantMeta}>`;
          }
        }

        entry += `\n${content}\n</entry>`;
        return entry;
      })
      .join('\n\n');
  }

  /**
   * Extract text content from a chunk
   */
  private extractChunkText(chunk: MemoryChunk): string {
    const content = chunk.content;

    if (content.type === ChunkContentType.TEXT) {
      // Check if it's a simple TextContent or StructuredContent
      if ('text' in content && typeof content.text === 'string') {
        return content.text;
      }
      // For structured content, serialize relevant fields
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

    // For other types, try to serialize
    try {
      const { type, ...rest } = content;
      return JSON.stringify(rest, null, 2);
    } catch {
      return '[Non-text content]';
    }
  }

  /**
   * Estimate token count (rough approximation)
   * ~4 characters per token on average
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
