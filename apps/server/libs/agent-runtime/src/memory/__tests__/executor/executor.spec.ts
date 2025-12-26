/**
 * Unit tests for executor module
 */
import {
  ChunkType,
  ChunkContentType,
  ChunkRetentionStrategy,
  OperationType,
} from '../../types';
import { createChunk, createState, deriveChunk } from '../../factories';
import {
  applyOperation,
  applyOperations,
  createExecutionContext,
} from '../../executor';
import { InMemoryStorageProvider } from '../../storage';

describe('Executor Module', () => {
  let storage: InMemoryStorageProvider;

  beforeEach(() => {
    storage = new InMemoryStorageProvider();
  });

  describe('applyOperation', () => {
    describe('ADD operation', () => {
      it('should add a new chunk to state', async () => {
        const state = createState({ threadId: 'thread_1' });
        const chunk = createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: 'Hello', role: 'user' },
        });

        const context = createExecutionContext(storage, [chunk]);
        const result = await applyOperation(
          state,
          {
            type: OperationType.ADD,
            chunkId: chunk.id,
          },
          context,
        );

        expect(result.state.chunks.size).toBe(1);
        expect(result.state.chunks.get(chunk.id)).toBeDefined();
        expect(result.addedChunks.length).toBe(1);
      });
    });

    describe('DELETE operation', () => {
      it('should remove a chunk from state', async () => {
        const chunk = createChunk({
          type: ChunkType.AGENT,
          content: {
            type: ChunkContentType.TEXT,
            text: 'To delete',
            role: 'user',
          },
        });
        const state = createState({ threadId: 'thread_1', chunks: [chunk] });

        const context = createExecutionContext(storage);
        const result = await applyOperation(
          state,
          {
            type: OperationType.DELETE,
            chunkId: chunk.id,
          },
          context,
        );

        expect(result.state.chunks.size).toBe(0);
        expect(result.removedChunkIds).toContain(chunk.id);
      });
    });

    describe('UPDATE operation', () => {
      it('should update a chunk in state', async () => {
        const chunk = createChunk({
          type: ChunkType.AGENT,
          content: {
            type: ChunkContentType.TEXT,
            text: 'Original',
            role: 'user',
          },
          retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
        });
        const state = createState({ threadId: 'thread_1', chunks: [chunk] });

        const newChunk = deriveChunk(chunk, {
          retentionStrategy: ChunkRetentionStrategy.CRITICAL,
        });

        const context = createExecutionContext(storage, [newChunk]);
        const result = await applyOperation(
          state,
          {
            type: OperationType.UPDATE,
            targetChunkId: chunk.id,
            newChunkId: newChunk.id,
          },
          context,
        );

        expect(result.state.chunks.get(newChunk.id)?.retentionStrategy).toBe(
          ChunkRetentionStrategy.CRITICAL,
        );
        expect(result.state.chunks.has(chunk.id)).toBe(false);
      });
    });

    describe('REORDER operation', () => {
      it('should reorder chunks in state', async () => {
        const chunk1 = createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: '1', role: 'user' },
        });
        const chunk2 = createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: '2', role: 'user' },
        });
        const state = createState({
          threadId: 'thread_1',
          chunks: [chunk1, chunk2],
        });

        const context = createExecutionContext(storage);
        const result = await applyOperation(
          state,
          {
            type: OperationType.REORDER,
            chunkId: chunk2.id,
            newPosition: 0,
          },
          context,
        );

        expect(result.state.chunkIds[0]).toBe(chunk2.id);
        expect(result.state.chunkIds[1]).toBe(chunk1.id);
      });
    });

    describe('BATCH_REPLACE operation', () => {
      it('should replace multiple chunks with one', async () => {
        const oldChunk1 = createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: 'Old1', role: 'user' },
        });
        const oldChunk2 = createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: 'Old2', role: 'user' },
        });
        const newChunk = createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: 'New', role: 'user' },
        });
        const state = createState({
          threadId: 'thread_1',
          chunks: [oldChunk1, oldChunk2],
        });

        const context = createExecutionContext(storage, [newChunk]);
        const result = await applyOperation(
          state,
          {
            type: OperationType.BATCH_REPLACE,
            targetChunkIds: [oldChunk1.id, oldChunk2.id],
            newChunkId: newChunk.id,
          },
          context,
        );

        expect(result.state.chunks.size).toBe(1);
        expect(result.state.chunks.get(newChunk.id)).toBeDefined();
        expect(result.removedChunkIds).toContain(oldChunk1.id);
        expect(result.removedChunkIds).toContain(oldChunk2.id);
      });
    });

    describe('BATCH operation', () => {
      it('should apply multiple operations', async () => {
        const chunk1 = createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: 'Keep', role: 'user' },
        });
        const chunk2 = createChunk({
          type: ChunkType.AGENT,
          content: {
            type: ChunkContentType.TEXT,
            text: 'Delete',
            role: 'user',
          },
        });
        const chunk3 = createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: 'Add', role: 'user' },
        });
        const state = createState({
          threadId: 'thread_1',
          chunks: [chunk1, chunk2],
        });

        const context = createExecutionContext(storage, [chunk3]);
        const result = await applyOperation(
          state,
          {
            type: OperationType.BATCH,
            operations: [
              { type: OperationType.DELETE, chunkId: chunk2.id },
              { type: OperationType.ADD, chunkId: chunk3.id },
            ],
          },
          context,
        );

        expect(result.state.chunks.size).toBe(2);
        expect(result.state.chunks.has(chunk1.id)).toBe(true);
        expect(result.state.chunks.has(chunk3.id)).toBe(true);
        expect(result.state.chunks.has(chunk2.id)).toBe(false);
      });
    });
  });

  describe('applyOperations', () => {
    it('should apply multiple operations sequentially', async () => {
      const state = createState({ threadId: 'thread_1' });
      const chunk1 = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: '1', role: 'user' },
      });
      const chunk2 = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: '2', role: 'user' },
      });

      const context = createExecutionContext(storage, [chunk1, chunk2]);
      const result = await applyOperations(
        state,
        [
          { type: OperationType.ADD, chunkId: chunk1.id },
          { type: OperationType.ADD, chunkId: chunk2.id },
        ],
        context,
      );

      expect(result.state.chunks.size).toBe(2);
    });
  });
});
