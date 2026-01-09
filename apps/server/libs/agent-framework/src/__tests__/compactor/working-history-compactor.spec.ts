/**
 * Unit tests for Working History Compaction Operations
 * Tests the component-based compaction functions
 */
import {
  compactWorkingHistory,
  isCompressibleChunk,
  hasCompressibleChunks,
  shouldTriggerCompaction,
  getRetainedChunks,
  extractChunkText,
} from '../../components/base/working-history/index.js';
import { createChunk, createState } from '../../factories/index.js';
import {
  ChunkType,
  ChunkContentType,
  ChunkRetentionStrategy,
} from '../../types/index.js';
import { ILLMAdapter, LLMCompletionResponse } from '../../llm/llm.types.js';

// Mock LLM Adapter
class MockLLMAdapter implements ILLMAdapter {
  private mockResponse: string = 'Compacted summary';
  public lastPrompt: string = '';

  setMockResponse(response: string): void {
    this.mockResponse = response;
  }

  async complete(request: {
    messages: Array<{ role: string; content: string }>;
  }): Promise<LLMCompletionResponse> {
    // Capture the prompt for testing
    this.lastPrompt = request.messages[0]?.content ?? '';
    return {
      content: this.mockResponse,
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      },
    };
  }
}

describe('Working History Compaction Operations', () => {
  let llmAdapter: MockLLMAdapter;

  beforeEach(() => {
    llmAdapter = new MockLLMAdapter();
  });

  describe('isCompressibleChunk', () => {
    it('should return true for conversation chunks with COMPRESSIBLE strategy', () => {
      const chunk = createChunk({
        type: ChunkType.THINKING,
        content: { type: ChunkContentType.TEXT, text: 'Thinking...' },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });

      expect(isCompressibleChunk(chunk)).toBe(true);
    });

    it('should return true for conversation chunks with BATCH_COMPRESSIBLE strategy', () => {
      const chunk = createChunk({
        type: ChunkType.AGENT_RESPONSE,
        content: { type: ChunkContentType.TEXT, text: 'Planning...' },
        retentionStrategy: ChunkRetentionStrategy.BATCH_COMPRESSIBLE,
      });

      expect(isCompressibleChunk(chunk)).toBe(true);
    });

    it('should return true for conversation chunks with DISPOSABLE strategy', () => {
      const chunk = createChunk({
        type: ChunkType.AGENT_ACTION,
        content: { type: ChunkContentType.TEXT, text: 'Debug log' },
        retentionStrategy: ChunkRetentionStrategy.DISPOSABLE,
      });

      expect(isCompressibleChunk(chunk)).toBe(true);
    });

    it('should return false for non-conversation chunks', () => {
      const chunk = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: 'Agent info' },
      });

      expect(isCompressibleChunk(chunk)).toBe(false);
    });

    it('should return false for CRITICAL retention strategy chunks', () => {
      const chunk = createChunk({
        type: ChunkType.USER_MESSAGE,
        content: { type: ChunkContentType.TEXT, text: 'Critical info' },
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      });

      expect(isCompressibleChunk(chunk)).toBe(false);
    });
  });

  describe('hasCompressibleChunks', () => {
    it('should return false when no WORKING_HISTORY chunk exists', () => {
      const state = createState({ threadId: 'thread_1', chunks: [] });
      expect(hasCompressibleChunks(state)).toBe(false);
    });

    it('should return false when WORKING_HISTORY has no compressible children', () => {
      const criticalChunk = createChunk({
        type: ChunkType.USER_MESSAGE,
        content: { type: ChunkContentType.TEXT, text: 'Critical' },
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      });

      const workingHistoryChunk = createChunk({
        type: ChunkType.WORKING_HISTORY,
        content: { type: ChunkContentType.TEXT, text: '' },
        childIds: [criticalChunk.id],
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [workingHistoryChunk, criticalChunk],
      });

      expect(hasCompressibleChunks(state)).toBe(false);
    });

    it('should return true when WORKING_HISTORY has compressible children', () => {
      const compressibleChunk = createChunk({
        type: ChunkType.AGENT_RESPONSE,
        content: { type: ChunkContentType.TEXT, text: 'Response' },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });

      const workingHistoryChunk = createChunk({
        type: ChunkType.WORKING_HISTORY,
        content: { type: ChunkContentType.TEXT, text: '' },
        childIds: [compressibleChunk.id],
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [workingHistoryChunk, compressibleChunk],
      });

      expect(hasCompressibleChunks(state)).toBe(true);
    });
  });

  describe('shouldTriggerCompaction', () => {
    it('should return false when no WORKING_HISTORY chunk exists', () => {
      const state = createState({ threadId: 'thread_1', chunks: [] });
      expect(shouldTriggerCompaction(state)).toBe(false);
    });

    it('should return false when below min chunk count', () => {
      const compressibleChunk = createChunk({
        type: ChunkType.AGENT_RESPONSE,
        content: { type: ChunkContentType.TEXT, text: 'Response' },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });

      const workingHistoryChunk = createChunk({
        type: ChunkType.WORKING_HISTORY,
        content: { type: ChunkContentType.TEXT, text: '' },
        childIds: [compressibleChunk.id],
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [workingHistoryChunk, compressibleChunk],
      });

      expect(shouldTriggerCompaction(state, { minChunkCount: 3 })).toBe(false);
    });

    it('should return true when conditions are met', () => {
      // Create many compressible chunks with enough content
      const chunks = [];
      const childIds = [];
      for (let i = 0; i < 5; i++) {
        const chunk = createChunk({
          type: ChunkType.AGENT_RESPONSE,
          content: { type: ChunkContentType.TEXT, text: 'A'.repeat(50000) },
          retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
        });
        chunks.push(chunk);
        childIds.push(chunk.id);
      }

      const workingHistoryChunk = createChunk({
        type: ChunkType.WORKING_HISTORY,
        content: { type: ChunkContentType.TEXT, text: '' },
        childIds,
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [workingHistoryChunk, ...chunks],
      });

      expect(
        shouldTriggerCompaction(state, {
          tokenThreshold: 1000,
          minChunkCount: 3,
        }),
      ).toBe(true);
    });
  });

  describe('getRetainedChunks', () => {
    it('should return empty array when no CRITICAL chunks exist', () => {
      const compressibleChunk = createChunk({
        type: ChunkType.AGENT_RESPONSE,
        content: { type: ChunkContentType.TEXT, text: 'Response' },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [compressibleChunk],
      });

      expect(getRetainedChunks(state)).toHaveLength(0);
    });

    it('should return CRITICAL conversation-type chunks', () => {
      const criticalChunk = createChunk({
        type: ChunkType.USER_MESSAGE,
        content: { type: ChunkContentType.TEXT, text: 'Critical' },
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [criticalChunk],
      });

      const retained = getRetainedChunks(state);
      expect(retained).toHaveLength(1);
      expect(retained[0].id).toBe(criticalChunk.id);
    });

    it('should not return CRITICAL non-conversation-type chunks', () => {
      const systemChunk = createChunk({
        type: ChunkType.SYSTEM,
        content: { type: ChunkContentType.TEXT, text: 'System' },
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [systemChunk],
      });

      expect(getRetainedChunks(state)).toHaveLength(0);
    });
  });

  describe('extractChunkText', () => {
    it('should extract text from TEXT content type', () => {
      const chunk = createChunk({
        type: ChunkType.USER_MESSAGE,
        content: { type: ChunkContentType.TEXT, text: 'Hello world' },
      });

      expect(extractChunkText(chunk)).toBe('Hello world');
    });

    it('should extract text from MIXED content type', () => {
      const chunk = createChunk({
        type: ChunkType.USER_MESSAGE,
        content: {
          type: ChunkContentType.MIXED,
          parts: [
            { type: ChunkContentType.TEXT, text: 'Part 1' },
            { type: ChunkContentType.TEXT, text: 'Part 2' },
          ],
        },
      });

      expect(extractChunkText(chunk)).toBe('Part 1\nPart 2');
    });
  });

  describe('compactWorkingHistory', () => {
    it('should compact chunks and return result', async () => {
      const compressibleChunk1 = createChunk({
        type: ChunkType.THINKING,
        content: {
          type: ChunkContentType.TEXT,
          text: 'Analyzing the problem...',
        },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });

      const compressibleChunk2 = createChunk({
        type: ChunkType.THINKING,
        content: {
          type: ChunkContentType.TEXT,
          text: 'Planning solution...',
        },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });

      const workingHistoryChunk = createChunk({
        type: ChunkType.WORKING_HISTORY,
        content: { type: ChunkContentType.TEXT, text: '' },
        childIds: [compressibleChunk1.id, compressibleChunk2.id],
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [workingHistoryChunk, compressibleChunk1, compressibleChunk2],
      });

      llmAdapter.setMockResponse(
        '## Summary\n\nAnalyzed problem and planned solution.',
      );

      const result = await compactWorkingHistory(state, llmAdapter);

      expect(result.compactedChunk).toBeDefined();
      expect(result.compactedChunk.type).toBe(ChunkType.COMPACTED);
      expect(result.originalChunkIds.length).toBe(2);
      expect(result.tokensBefore).toBeGreaterThan(0);
      expect(result.tokensAfter).toBeGreaterThan(0);
    });

    it('should include parent IDs in compacted chunk', async () => {
      const compressibleChunk1 = createChunk({
        type: ChunkType.USER_MESSAGE,
        content: { type: ChunkContentType.TEXT, text: 'Work 1' },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });

      const compressibleChunk2 = createChunk({
        type: ChunkType.AGENT_RESPONSE,
        content: { type: ChunkContentType.TEXT, text: 'Work 2' },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });

      const workingHistoryChunk = createChunk({
        type: ChunkType.WORKING_HISTORY,
        content: { type: ChunkContentType.TEXT, text: '' },
        childIds: [compressibleChunk1.id, compressibleChunk2.id],
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [workingHistoryChunk, compressibleChunk1, compressibleChunk2],
      });

      const result = await compactWorkingHistory(state, llmAdapter);

      expect(result.compactedChunk.metadata.parentIds).toContain(
        compressibleChunk1.id,
      );
      expect(result.compactedChunk.metadata.parentIds).toContain(
        compressibleChunk2.id,
      );
    });

    it('should throw error when no WORKING_HISTORY chunk exists', async () => {
      const state = createState({ threadId: 'thread_1', chunks: [] });

      await expect(compactWorkingHistory(state, llmAdapter)).rejects.toThrow(
        'No WORKING_HISTORY chunk found in state',
      );
    });

    it('should throw error when no compressible chunks exist', async () => {
      const criticalChunk = createChunk({
        type: ChunkType.USER_MESSAGE,
        content: { type: ChunkContentType.TEXT, text: 'Critical' },
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      });

      const workingHistoryChunk = createChunk({
        type: ChunkType.WORKING_HISTORY,
        content: { type: ChunkContentType.TEXT, text: '' },
        childIds: [criticalChunk.id],
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [workingHistoryChunk, criticalChunk],
      });

      await expect(compactWorkingHistory(state, llmAdapter)).rejects.toThrow(
        'No compressible chunks found in WORKING_HISTORY',
      );
    });

    it('should include context in compaction', async () => {
      const systemChunk = createChunk({
        type: ChunkType.SYSTEM,
        content: { type: ChunkContentType.TEXT, text: 'System instructions' },
      });

      const workingChunk = createChunk({
        type: ChunkType.THINKING,
        content: { type: ChunkContentType.TEXT, text: 'Working...' },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });

      const workingHistoryChunk = createChunk({
        type: ChunkType.WORKING_HISTORY,
        content: { type: ChunkContentType.TEXT, text: '' },
        childIds: [workingChunk.id],
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [systemChunk, workingChunk, workingHistoryChunk],
      });

      const result = await compactWorkingHistory(state, llmAdapter);

      expect(result.compactedChunk).toBeDefined();
    });

    it('should store metadata about compaction', async () => {
      const chunk = createChunk({
        type: ChunkType.AGENT_RESPONSE,
        content: { type: ChunkContentType.TEXT, text: 'Working...' },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });

      const workingHistoryChunk = createChunk({
        type: ChunkType.WORKING_HISTORY,
        content: { type: ChunkContentType.TEXT, text: '' },
        childIds: [chunk.id],
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [workingHistoryChunk, chunk],
      });

      const result = await compactWorkingHistory(state, llmAdapter);

      expect(result.compactedChunk.metadata.custom?.compactedAt).toBeDefined();
      expect(result.compactedChunk.metadata.custom?.originalChunkCount).toBe(1);
      expect(result.compactedChunk.metadata.custom?.tokensUsed).toBeDefined();
    });

    it('should include CRITICAL chunks as retained content in prompt', async () => {
      // Create a CRITICAL chunk that should be shown as retained content
      const criticalChunk = createChunk({
        type: ChunkType.USER_MESSAGE,
        content: {
          type: ChunkContentType.TEXT,
          text: 'This is critical information that must be retained',
        },
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      });

      // Create a COMPRESSIBLE chunk that will be compacted
      const compressibleChunk = createChunk({
        type: ChunkType.AGENT_RESPONSE,
        content: {
          type: ChunkContentType.TEXT,
          text: 'This is compressible content',
        },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });

      const workingHistoryChunk = createChunk({
        type: ChunkType.WORKING_HISTORY,
        content: { type: ChunkContentType.TEXT, text: '' },
        childIds: [compressibleChunk.id],
      });

      // State contains both chunks
      const state = createState({
        threadId: 'thread_1',
        chunks: [criticalChunk, compressibleChunk, workingHistoryChunk],
      });

      await compactWorkingHistory(state, llmAdapter);

      // Verify the prompt includes the critical chunk as retained content
      expect(llmAdapter.lastPrompt).toContain('<retained_content>');
      expect(llmAdapter.lastPrompt).toContain(
        'This is critical information that must be retained',
      );
      expect(llmAdapter.lastPrompt).toContain('<retained_entry');
      expect(llmAdapter.lastPrompt).toContain('type="USER_MESSAGE"');
    });

    it('should show "No retained content" when no CRITICAL chunks exist', async () => {
      const compressibleChunk = createChunk({
        type: ChunkType.THINKING,
        content: { type: ChunkContentType.TEXT, text: 'Thinking...' },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });

      const workingHistoryChunk = createChunk({
        type: ChunkType.WORKING_HISTORY,
        content: { type: ChunkContentType.TEXT, text: '' },
        childIds: [compressibleChunk.id],
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [compressibleChunk, workingHistoryChunk],
      });

      await compactWorkingHistory(state, llmAdapter);

      expect(llmAdapter.lastPrompt).toContain('No retained content.');
    });

    it('should only include conversation-type CRITICAL chunks as retained content', async () => {
      // CRITICAL SYSTEM chunk (non-conversation type) - should NOT be in retained content
      const systemChunk = createChunk({
        type: ChunkType.SYSTEM,
        content: { type: ChunkContentType.TEXT, text: 'System prompt' },
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      });

      // CRITICAL USER_MESSAGE chunk (conversation type) - should be in retained content
      const criticalUserMessage = createChunk({
        type: ChunkType.USER_MESSAGE,
        content: {
          type: ChunkContentType.TEXT,
          text: 'Important user request',
        },
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      });

      // Compressible chunk
      const compressibleChunk = createChunk({
        type: ChunkType.AGENT_RESPONSE,
        content: { type: ChunkContentType.TEXT, text: 'Response' },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });

      const workingHistoryChunk = createChunk({
        type: ChunkType.WORKING_HISTORY,
        content: { type: ChunkContentType.TEXT, text: '' },
        childIds: [compressibleChunk.id],
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [
          systemChunk,
          criticalUserMessage,
          compressibleChunk,
          workingHistoryChunk,
        ],
      });

      await compactWorkingHistory(state, llmAdapter);

      // Should include the critical user message
      expect(llmAdapter.lastPrompt).toContain('Important user request');
      // Should NOT include system chunk in retained_content section
      // (system chunks go in context section instead)
      const retainedSection = llmAdapter.lastPrompt.match(
        /<retained_content>[\s\S]*?<\/retained_content>/,
      )?.[0];
      expect(retainedSection).not.toContain('System prompt');
    });

    it('should filter out CRITICAL chunks from compaction result', async () => {
      // CRITICAL chunk - should NOT be in originalChunkIds
      const criticalChunk = createChunk({
        type: ChunkType.USER_MESSAGE,
        content: { type: ChunkContentType.TEXT, text: 'Critical message' },
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      });

      // COMPRESSIBLE chunks - should be compacted
      const compressibleChunk1 = createChunk({
        type: ChunkType.AGENT_RESPONSE,
        content: { type: ChunkContentType.TEXT, text: 'Response 1' },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });

      const compressibleChunk2 = createChunk({
        type: ChunkType.THINKING,
        content: { type: ChunkContentType.TEXT, text: 'Thinking...' },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });

      // WORKING_HISTORY includes both CRITICAL and COMPRESSIBLE
      const workingHistoryChunk = createChunk({
        type: ChunkType.WORKING_HISTORY,
        content: { type: ChunkContentType.TEXT, text: '' },
        childIds: [
          criticalChunk.id,
          compressibleChunk1.id,
          compressibleChunk2.id,
        ],
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [
          criticalChunk,
          compressibleChunk1,
          compressibleChunk2,
          workingHistoryChunk,
        ],
      });

      const result = await compactWorkingHistory(state, llmAdapter);

      // Result should only reference the compressible chunks
      expect(result.originalChunkIds).toHaveLength(2);
      expect(result.originalChunkIds).toContain(compressibleChunk1.id);
      expect(result.originalChunkIds).toContain(compressibleChunk2.id);
      expect(result.originalChunkIds).not.toContain(criticalChunk.id);

      // Parent IDs should also only reference compressible chunks
      expect(result.compactedChunk.metadata.parentIds).toHaveLength(2);
      expect(result.compactedChunk.metadata.parentIds).not.toContain(
        criticalChunk.id,
      );

      // The working history section should not contain the critical chunk content
      const workingHistorySection = llmAdapter.lastPrompt.match(
        /<working_history_to_compact>[\s\S]*?<\/working_history_to_compact>/,
      )?.[0];
      expect(workingHistorySection).not.toContain('Critical message');
      expect(workingHistorySection).toContain('Response 1');
      expect(workingHistorySection).toContain('Thinking...');
    });
  });
});
