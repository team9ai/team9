/**
 * Unit tests for WorkingFlowCompactor
 */
import { WorkingFlowCompactor } from '../../compactor/working-flow.compactor';
import { createChunk, createState } from '../../factories';
import {
  ChunkType,
  ChunkContentType,
  ChunkRetentionStrategy,
  WorkingFlowSubType,
} from '../../types';
import {
  ILLMAdapter,
  LLMConfig,
  LLMCompletionResponse,
} from '../../llm/llm.types';

// Mock LLM Adapter
class MockLLMAdapter implements ILLMAdapter {
  private mockResponse: string = 'Compacted summary';

  setMockResponse(response: string): void {
    this.mockResponse = response;
  }

  async complete(): Promise<LLMCompletionResponse> {
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

describe('WorkingFlowCompactor', () => {
  let llmAdapter: MockLLMAdapter;
  let compactor: WorkingFlowCompactor;
  const config: LLMConfig = {
    model: 'gpt-4',
    temperature: 0.3,
    maxTokens: 2000,
  };

  beforeEach(() => {
    llmAdapter = new MockLLMAdapter();
    compactor = new WorkingFlowCompactor(llmAdapter, config);
  });

  describe('canCompact', () => {
    it('should return false for empty chunks', () => {
      expect(compactor.canCompact([])).toBe(false);
    });

    it('should return true for WORKING_FLOW chunks with COMPRESSIBLE strategy', () => {
      const chunks = [
        createChunk({
          type: ChunkType.WORKING_FLOW,
          content: { type: ChunkContentType.TEXT, text: 'Thinking...' },
          retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
        }),
      ];

      expect(compactor.canCompact(chunks)).toBe(true);
    });

    it('should return true for WORKING_FLOW chunks with BATCH_COMPRESSIBLE strategy', () => {
      const chunks = [
        createChunk({
          type: ChunkType.WORKING_FLOW,
          content: { type: ChunkContentType.TEXT, text: 'Planning...' },
          retentionStrategy: ChunkRetentionStrategy.BATCH_COMPRESSIBLE,
        }),
      ];

      expect(compactor.canCompact(chunks)).toBe(true);
    });

    it('should return true for WORKING_FLOW chunks with DISPOSABLE strategy', () => {
      const chunks = [
        createChunk({
          type: ChunkType.WORKING_FLOW,
          content: { type: ChunkContentType.TEXT, text: 'Debug log' },
          retentionStrategy: ChunkRetentionStrategy.DISPOSABLE,
        }),
      ];

      expect(compactor.canCompact(chunks)).toBe(true);
    });

    it('should return false for non-WORKING_FLOW chunks', () => {
      const chunks = [
        createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: 'User message' },
        }),
      ];

      expect(compactor.canCompact(chunks)).toBe(false);
    });

    it('should return false for CRITICAL retention strategy', () => {
      const chunks = [
        createChunk({
          type: ChunkType.WORKING_FLOW,
          content: { type: ChunkContentType.TEXT, text: 'Critical info' },
          retentionStrategy: ChunkRetentionStrategy.CRITICAL,
        }),
      ];

      expect(compactor.canCompact(chunks)).toBe(false);
    });

    it('should return false for mixed chunk types', () => {
      const chunks = [
        createChunk({
          type: ChunkType.WORKING_FLOW,
          content: { type: ChunkContentType.TEXT, text: 'Thinking...' },
          retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
        }),
        createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: 'User message' },
        }),
      ];

      expect(compactor.canCompact(chunks)).toBe(false);
    });
  });

  describe('compact', () => {
    it('should compact chunks and return result', async () => {
      const chunks = [
        createChunk({
          type: ChunkType.WORKING_FLOW,
          subType: WorkingFlowSubType.THINKING,
          content: {
            type: ChunkContentType.TEXT,
            text: 'Analyzing the problem...',
          },
          retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
        }),
        createChunk({
          type: ChunkType.WORKING_FLOW,
          subType: WorkingFlowSubType.THINKING,
          content: {
            type: ChunkContentType.TEXT,
            text: 'Planning solution...',
          },
          retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
        }),
      ];

      const state = createState({ threadId: 'thread_1', chunks });

      llmAdapter.setMockResponse(
        '## Summary\n\nAnalyzed problem and planned solution.',
      );

      const result = await compactor.compact(chunks, { state });

      expect(result.compactedChunk).toBeDefined();
      expect(result.compactedChunk.type).toBe(ChunkType.WORKING_FLOW);
      expect(result.compactedChunk.subType).toBe(WorkingFlowSubType.COMPACTED);
      expect(result.originalChunkIds.length).toBe(2);
      expect(result.tokensBefore).toBeGreaterThan(0);
      expect(result.tokensAfter).toBeGreaterThan(0);
    });

    it('should include parent IDs in compacted chunk', async () => {
      const chunks = [
        createChunk({
          type: ChunkType.WORKING_FLOW,
          content: { type: ChunkContentType.TEXT, text: 'Work 1' },
          retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
        }),
        createChunk({
          type: ChunkType.WORKING_FLOW,
          content: { type: ChunkContentType.TEXT, text: 'Work 2' },
          retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
        }),
      ];

      const state = createState({ threadId: 'thread_1', chunks });
      const result = await compactor.compact(chunks, { state });

      expect(result.compactedChunk.metadata.parentIds).toContain(chunks[0].id);
      expect(result.compactedChunk.metadata.parentIds).toContain(chunks[1].id);
    });

    it('should throw error for non-compactable chunks', async () => {
      const chunks = [
        createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: 'Cannot compact' },
        }),
      ];

      const state = createState({ threadId: 'thread_1' });

      await expect(compactor.compact(chunks, { state })).rejects.toThrow(
        'WorkingFlowCompactor cannot compact these chunks',
      );
    });

    it('should include context in compaction', async () => {
      const systemChunk = createChunk({
        type: ChunkType.SYSTEM,
        content: { type: ChunkContentType.TEXT, text: 'System instructions' },
      });

      const workingChunk = createChunk({
        type: ChunkType.WORKING_FLOW,
        content: { type: ChunkContentType.TEXT, text: 'Working...' },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [systemChunk, workingChunk],
      });

      const result = await compactor.compact([workingChunk], {
        state,
        taskGoal: 'Complete the feature',
        progressSummary: 'Step 1 completed',
      });

      expect(result.compactedChunk).toBeDefined();
    });

    it('should store metadata about compaction', async () => {
      const chunk = createChunk({
        type: ChunkType.WORKING_FLOW,
        content: { type: ChunkContentType.TEXT, text: 'Working...' },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      });

      const state = createState({ threadId: 'thread_1' });
      const result = await compactor.compact([chunk], { state });

      expect(result.compactedChunk.metadata.custom?.compactedAt).toBeDefined();
      expect(result.compactedChunk.metadata.custom?.originalChunkCount).toBe(1);
      expect(result.compactedChunk.metadata.custom?.tokensUsed).toBeDefined();
    });
  });
});
