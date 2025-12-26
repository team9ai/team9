/**
 * Unit tests for factories module
 */
import {
  createChunk,
  deriveChunk,
  createState,
  deriveState,
  createThread,
  createAddOperation,
  createDeleteOperation,
  createUpdateOperation,
  createBatchOperation,
} from '../../factories';
import {
  ChunkType,
  ChunkContentType,
  ChunkRetentionStrategy,
  OperationType,
} from '../../types';

describe('Factories Module', () => {
  describe('createChunk', () => {
    it('should create chunk with required fields', () => {
      const chunk = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: 'Hello', role: 'user' },
      });

      expect(chunk.id).toBeDefined();
      expect(chunk.type).toBe(ChunkType.AGENT);
      expect(chunk.content.type).toBe(ChunkContentType.TEXT);
      expect(chunk.metadata.createdAt).toBeDefined();
    });

    it('should create chunk with retention strategy', () => {
      const chunk = createChunk({
        type: ChunkType.OUTPUT,
        content: { type: ChunkContentType.TEXT, text: 'Output' },
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      });

      expect(chunk.retentionStrategy).toBe(ChunkRetentionStrategy.CRITICAL);
    });

    it('should create chunk with custom metadata', () => {
      const chunk = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: 'Test' },
        custom: { key: 'value' },
      });

      expect(chunk.metadata.custom?.key).toBe('value');
    });
  });

  describe('deriveChunk', () => {
    it('should derive chunk with new fields', () => {
      const original = createChunk({
        type: ChunkType.AGENT,
        content: {
          type: ChunkContentType.TEXT,
          text: 'Original',
          role: 'user',
        },
      });

      const derived = deriveChunk(original, {
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      });

      // deriveChunk creates a NEW chunk with the original as parent
      expect(derived.id).not.toBe(original.id);
      expect(derived.retentionStrategy).toBe(ChunkRetentionStrategy.CRITICAL);
      expect(derived.metadata.parentIds).toContain(original.id);
    });
  });

  describe('createState', () => {
    it('should create empty state', () => {
      const state = createState({ threadId: 'thread_1' });

      expect(state.id).toBeDefined();
      expect(state.threadId).toBe('thread_1');
      expect(state.chunks).toBeInstanceOf(Map);
      expect(state.chunks.size).toBe(0);
      expect(state.chunkIds.length).toBe(0);
    });

    it('should create state with chunks', () => {
      const chunk = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: 'Hello' },
      });

      const state = createState({ threadId: 'thread_1', chunks: [chunk] });

      expect(state.chunks.size).toBe(1);
      expect(state.chunkIds.length).toBe(1);
      expect(state.chunks.get(chunk.id)).toBeDefined();
    });
  });

  describe('deriveState', () => {
    it('should derive state with new chunks', () => {
      const original = createState({ threadId: 'thread_1' });
      const chunk = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: 'New' },
      });

      const derived = deriveState(original, { chunks: [chunk] });

      expect(derived.id).not.toBe(original.id);
      expect(derived.metadata.previousStateId).toBe(original.id);
      expect(derived.chunks.size).toBe(1);
    });
  });

  describe('createThread', () => {
    it('should create thread with defaults', () => {
      const thread = createThread();

      expect(thread.id).toBeDefined();
      expect(thread.metadata.createdAt).toBeDefined();
      expect(thread.metadata.updatedAt).toBeDefined();
    });

    it('should create thread with custom metadata', () => {
      const thread = createThread({ custom: { agentId: 'agent_1' } });

      expect(thread.metadata.custom?.agentId).toBe('agent_1');
    });
  });

  describe('Operation factories', () => {
    it('should create ADD operation', () => {
      const chunk = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: 'Test' },
      });

      // createAddOperation takes chunkId string, not chunk object
      const op = createAddOperation(chunk.id);

      expect(op.type).toBe(OperationType.ADD);
      expect(op.chunkId).toBe(chunk.id);
    });

    it('should create DELETE operation', () => {
      const op = createDeleteOperation('chunk_123');

      expect(op.type).toBe(OperationType.DELETE);
      expect(op.chunkId).toBe('chunk_123');
    });

    it('should create UPDATE operation', () => {
      const originalChunk = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: 'Original' },
      });
      const newChunk = deriveChunk(originalChunk, {
        retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      });

      // createUpdateOperation takes two string IDs
      const op = createUpdateOperation(originalChunk.id, newChunk.id);

      expect(op.type).toBe(OperationType.UPDATE);
      expect(op.targetChunkId).toBe(originalChunk.id);
      expect(op.newChunkId).toBe(newChunk.id);
    });

    it('should create BATCH operation', () => {
      const chunk = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: 'Test' },
      });
      const op1 = createAddOperation(chunk.id);
      const op2 = createDeleteOperation('chunk_old');

      const batch = createBatchOperation([op1, op2]);

      expect(batch.type).toBe(OperationType.BATCH);
      expect(batch.operations.length).toBe(2);
    });
  });
});
