/**
 * Unit tests for executor module
 */
import {
  ChunkType,
  ChunkContentType,
  ChunkRetentionStrategy,
  WorkingFlowSubType,
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
  createAddChildOperation,
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

      it('should add a child to an existing WORKING_FLOW chunk and preserve content', async () => {
        // Create a WORKING_FLOW container chunk
        const container = createChunk({
          type: ChunkType.WORKING_FLOW,
          content: { type: ChunkContentType.TEXT, text: '' },
        });
        // Initialize with empty children array
        const containerWithChildren = { ...container, children: [] };

        const state = createState({
          threadId: 'thread_1',
          chunks: [containerWithChildren],
        });

        // Create the child content with all fields
        const childContent = {
          type: ChunkContentType.TEXT,
          text: 'Hello, this is a user message!',
          attachments: ['file1.txt'],
        };

        const context = createExecutionContext(storage);
        const addChildOp = createAddChildOperation(container.id, {
          id: 'child_001',
          subType: WorkingFlowSubType.USER,
          content: childContent,
          createdAt: Date.now(),
          custom: { eventType: 'USER_MESSAGE' },
        });

        const result = await applyOperation(state, addChildOp, context);

        // ADD child creates a NEW chunk with a NEW ID (for immutability)
        // The new chunk should have derivedFrom pointing to the original
        expect(result.state.chunks.size).toBe(1);
        const chunks = Array.from(result.state.chunks.values());
        const updatedChunk = chunks[0];
        expect(updatedChunk).toBeDefined();
        expect(updatedChunk.id).not.toBe(container.id); // New ID
        expect(updatedChunk.metadata.custom?.derivedFrom).toBe(container.id);
        expect(updatedChunk.children).toBeDefined();
        expect(updatedChunk.children!.length).toBe(1);

        // Verify child content is preserved completely
        const child = updatedChunk.children![0];
        expect(child.id).toBe('child_001');
        expect(child.subType).toBe(WorkingFlowSubType.USER);
        expect(child.content).toEqual(childContent);

        // Explicitly check all content fields
        const content = child.content as {
          type: string;
          text: string;
          attachments: string[];
        };
        expect(content.type).toBe(ChunkContentType.TEXT);
        expect(content.text).toBe('Hello, this is a user message!');
        expect(content.attachments).toEqual(['file1.txt']);
      });

      it('should preserve children content through JSON serialization (simulating API)', async () => {
        // Create a WORKING_FLOW container chunk with a child
        const container = createChunk({
          type: ChunkType.WORKING_FLOW,
          content: { type: ChunkContentType.TEXT, text: '' },
        });

        const childContent = {
          type: ChunkContentType.TEXT,
          text: 'Test message content',
          role: 'user',
        };

        const containerWithChildren = {
          ...container,
          children: [
            {
              id: 'child_001',
              subType: WorkingFlowSubType.USER,
              content: childContent,
              createdAt: Date.now(),
            },
          ],
        };

        const state = createState({
          threadId: 'thread_1',
          chunks: [containerWithChildren],
        });

        // Simulate API serialization like in routes/agents.ts
        const chunks = Array.from(state.chunks.values());
        const serialized = JSON.stringify(chunks);
        const deserialized = JSON.parse(serialized);

        // Verify the child content is preserved
        expect(deserialized[0].children).toBeDefined();
        expect(deserialized[0].children.length).toBe(1);
        expect(deserialized[0].children[0].content).toEqual(childContent);
        expect(deserialized[0].children[0].content.text).toBe(
          'Test message content',
        );
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
