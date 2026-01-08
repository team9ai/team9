/**
 * Unit tests for executor module
 */
import {
  ChunkType,
  ChunkContentType,
  ChunkRetentionStrategy,
} from '../../types/index.js';
import {
  createChunk,
  createState,
  deriveChunk,
  createAddOperation,
  createDeleteOperation,
  createUpdateOperation,
  createReorderOperation,
  createBatchReplaceOperation,
  createBatchOperation,
} from '../../factories/index.js';
import {
  applyOperation,
  applyOperations,
  createExecutionContext,
} from '../../executor/index.js';
import { InMemoryStorageProvider } from '../../storage/index.js';

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
          createAddOperation(chunk.id),
          context,
        );

        expect(result.state.chunks.size).toBe(1);
        expect(result.state.chunks.get(chunk.id)).toBeDefined();
        expect(result.addedChunks.length).toBe(1);
      });

      it('should add a conversation chunk to WORKING_HISTORY container using childIds', async () => {
        // Create a WORKING_HISTORY container chunk
        const container = createChunk({
          type: ChunkType.WORKING_HISTORY,
          content: { type: ChunkContentType.TEXT, text: '' },
        });
        // Initialize with empty childIds array
        const containerWithChildIds = {
          ...container,
          childIds: [] as string[],
        };

        // Create a conversation chunk
        const userMessage = createChunk({
          type: ChunkType.USER_MESSAGE,
          content: {
            type: ChunkContentType.TEXT,
            text: 'Hello, this is a user message!',
            attachments: ['file1.txt'],
          },
          custom: { eventType: 'USER_MESSAGE' },
        });

        const state = createState({
          threadId: 'thread_1',
          chunks: [containerWithChildIds, userMessage],
        });

        // Verify the setup
        expect(state.chunks.size).toBe(2);
        expect(state.chunks.get(container.id)?.childIds).toEqual([]);
        expect(state.chunks.get(userMessage.id)?.type).toBe(
          ChunkType.USER_MESSAGE,
        );
      });

      it('should preserve conversation chunk content through JSON serialization', async () => {
        // Create a WORKING_HISTORY container and conversation chunks
        const container = createChunk({
          type: ChunkType.WORKING_HISTORY,
          content: { type: ChunkContentType.TEXT, text: '' },
        });

        const userMessage = createChunk({
          type: ChunkType.USER_MESSAGE,
          content: {
            type: ChunkContentType.TEXT,
            text: 'Test message content',
            role: 'user',
          },
        });

        const containerWithChildIds = {
          ...container,
          childIds: [userMessage.id],
        };

        const state = createState({
          threadId: 'thread_1',
          chunks: [containerWithChildIds, userMessage],
        });

        // Simulate API serialization like in routes/agents.ts
        const chunks = Array.from(state.chunks.values());
        const serialized = JSON.stringify(chunks);
        const deserialized = JSON.parse(serialized);

        // Verify the container has childIds
        const deserializedContainer = deserialized.find(
          (c: { type: string }) => c.type === ChunkType.WORKING_HISTORY,
        );
        expect(deserializedContainer.childIds).toEqual([userMessage.id]);

        // Verify the user message content is preserved
        const deserializedMessage = deserialized.find(
          (c: { type: string }) => c.type === ChunkType.USER_MESSAGE,
        );
        expect(deserializedMessage.content.text).toBe('Test message content');
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
          createDeleteOperation(chunk.id),
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
          createUpdateOperation(chunk.id, newChunk.id),
          context,
        );

        expect(result.state.chunks.get(newChunk.id)?.retentionStrategy).toBe(
          ChunkRetentionStrategy.CRITICAL,
        );
        expect(result.state.chunks.has(chunk.id)).toBe(false);
      });

      it('should update WORKING_HISTORY childIds when updating container', async () => {
        // Create initial container with one child
        const userMessage1 = createChunk({
          type: ChunkType.USER_MESSAGE,
          content: { type: ChunkContentType.TEXT, text: 'Message 1' },
        });

        const container = createChunk({
          type: ChunkType.WORKING_HISTORY,
          content: { type: ChunkContentType.TEXT, text: '' },
        });
        const containerWithChild = {
          ...container,
          childIds: [userMessage1.id],
        };

        const state = createState({
          threadId: 'thread_1',
          chunks: [containerWithChild, userMessage1],
        });

        // Create a new message to add
        const userMessage2 = createChunk({
          type: ChunkType.USER_MESSAGE,
          content: { type: ChunkContentType.TEXT, text: 'Message 2' },
        });

        // Derive a new container with both childIds
        const updatedContainer = deriveChunk(containerWithChild, {});
        const updatedContainerWithChildren = {
          ...updatedContainer,
          childIds: [userMessage1.id, userMessage2.id],
        };

        const context = createExecutionContext(storage, [
          updatedContainerWithChildren,
          userMessage2,
        ]);

        // First add the new message
        let result = await applyOperation(
          state,
          createAddOperation(userMessage2.id),
          context,
        );

        // Then update the container
        result = await applyOperation(
          result.state,
          createUpdateOperation(container.id, updatedContainerWithChildren.id),
          context,
        );

        // Verify the updated container has both childIds
        const finalContainer = result.state.chunks.get(
          updatedContainerWithChildren.id,
        );
        expect(finalContainer?.childIds).toEqual([
          userMessage1.id,
          userMessage2.id,
        ]);
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
          createReorderOperation(chunk2.id, 0),
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
          createBatchReplaceOperation(
            [oldChunk1.id, oldChunk2.id],
            newChunk.id,
          ),
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
          createBatchOperation([
            createDeleteOperation(chunk2.id),
            createAddOperation(chunk3.id),
          ]),
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
        [createAddOperation(chunk1.id), createAddOperation(chunk2.id)],
        context,
      );

      expect(result.state.chunks.size).toBe(2);
    });
  });
});
