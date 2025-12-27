/**
 * Unit tests for storage module
 */
import { ChunkType, ChunkContentType } from '../../types/index.js';
import {
  createChunk,
  createState,
  createThread,
} from '../../factories/index.js';
import { InMemoryStorageProvider } from '../../storage/index.js';

describe('Storage Module', () => {
  describe('Thread Operations', () => {
    it('should save and get thread', async () => {
      const storage = new InMemoryStorageProvider();
      const thread = createThread({ custom: { agentId: 'agent_1' } });

      await storage.saveThread(thread);
      const retrieved = await storage.getThread(thread.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(thread.id);
      expect(retrieved?.metadata.custom?.agentId).toBe('agent_1');
    });

    it('should return null for non-existent thread', async () => {
      const storage = new InMemoryStorageProvider();
      const result = await storage.getThread('non_existent');

      expect(result).toBeNull();
    });

    it('should update thread', async () => {
      const storage = new InMemoryStorageProvider();
      const thread = createThread({ custom: { status: 'active' } });

      await storage.saveThread(thread);

      const updatedThread = {
        ...thread,
        metadata: { ...thread.metadata, custom: { status: 'completed' } },
      };
      await storage.updateThread(updatedThread);

      const retrieved = await storage.getThread(thread.id);
      expect(retrieved?.metadata.custom?.status).toBe('completed');
    });

    it('should delete thread', async () => {
      const storage = new InMemoryStorageProvider();
      const thread = createThread();

      await storage.saveThread(thread);
      await storage.deleteThread(thread.id);

      const retrieved = await storage.getThread(thread.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('Chunk Operations', () => {
    it('should save and get chunk', async () => {
      const storage = new InMemoryStorageProvider();
      const chunk = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: 'Hello' },
      });

      await storage.saveChunk(chunk);
      const retrieved = await storage.getChunk(chunk.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(chunk.id);
    });

    it('should save chunks in batch', async () => {
      const storage = new InMemoryStorageProvider();
      const chunks = [
        createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: '1' },
        }),
        createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: '2' },
        }),
        createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: '3' },
        }),
      ];

      await storage.saveChunks(chunks);

      for (const chunk of chunks) {
        const retrieved = await storage.getChunk(chunk.id);
        expect(retrieved).not.toBeNull();
      }
    });

    it('should get chunks in batch', async () => {
      const storage = new InMemoryStorageProvider();
      const chunks = [
        createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: '1' },
        }),
        createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: '2' },
        }),
      ];

      await storage.saveChunks(chunks);

      const retrieved = await storage.getChunks([chunks[0].id, chunks[1].id]);
      expect(retrieved.size).toBe(2);
    });

    it('should delete chunk', async () => {
      const storage = new InMemoryStorageProvider();
      const chunk = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: 'To delete' },
      });

      await storage.saveChunk(chunk);
      await storage.deleteChunk(chunk.id);

      const retrieved = await storage.getChunk(chunk.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('State Operations', () => {
    it('should save and get state', async () => {
      const storage = new InMemoryStorageProvider();
      const state = createState({ threadId: 'thread_1' });

      await storage.saveState(state);
      const retrieved = await storage.getState(state.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(state.id);
    });

    it('should get latest state', async () => {
      const storage = new InMemoryStorageProvider();

      const state1 = createState({ threadId: 'thread_1' });
      await storage.saveState(state1);

      await new Promise((r) => setTimeout(r, 10));

      const chunk = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: 'New' },
      });
      const state2 = createState({ threadId: 'thread_1', chunks: [chunk] });
      await storage.saveState(state2);

      const latest = await storage.getLatestState('thread_1');
      expect(latest).not.toBeNull();
      expect(latest?.id).toBe(state2.id);
    });

    it('should get initial state', async () => {
      const storage = new InMemoryStorageProvider();

      const state1 = createState({ threadId: 'thread_1' });
      await storage.saveState(state1);

      await new Promise((r) => setTimeout(r, 10));

      const state2 = createState({ threadId: 'thread_1' });
      await storage.saveState(state2);

      const initial = await storage.getInitialState('thread_1');
      expect(initial).not.toBeNull();
      expect(initial?.id).toBe(state1.id);
    });

    it('should get states by thread', async () => {
      const storage = new InMemoryStorageProvider();

      const states = [
        createState({ threadId: 'thread_1' }),
        createState({ threadId: 'thread_1' }),
        createState({ threadId: 'thread_2' }),
      ];

      for (const state of states) {
        await storage.saveState(state);
        await new Promise((r) => setTimeout(r, 5));
      }

      const thread1States = await storage.getStatesByThread('thread_1');
      expect(thread1States.length).toBe(2);
    });

    it('should list states with filters', async () => {
      const storage = new InMemoryStorageProvider();

      const startTime = Date.now();
      await new Promise((r) => setTimeout(r, 10));

      const states = [
        createState({ threadId: 'thread_1' }),
        createState({ threadId: 'thread_1' }),
      ];

      for (const state of states) {
        await storage.saveState(state);
        await new Promise((r) => setTimeout(r, 5));
      }

      const midTime = Date.now();
      await new Promise((r) => setTimeout(r, 10));

      const state3 = createState({ threadId: 'thread_1' });
      await storage.saveState(state3);

      const filtered = await storage.listStates({
        threadId: 'thread_1',
        fromTimestamp: startTime,
        toTimestamp: midTime,
      });

      expect(filtered.length).toBe(2);

      const paginated = await storage.listStates({
        threadId: 'thread_1',
        limit: 1,
        offset: 1,
      });

      expect(paginated.length).toBe(1);
    });

    it('should delete state', async () => {
      const storage = new InMemoryStorageProvider();
      const state = createState({ threadId: 'thread_1' });

      await storage.saveState(state);
      await storage.deleteState(state.id);

      const retrieved = await storage.getState(state.id);
      expect(retrieved).toBeNull();
    });
  });

  describe('Transaction Support', () => {
    it('should execute transaction function', async () => {
      const storage = new InMemoryStorageProvider();

      const result = await storage.transaction(async (tx) => {
        const chunk = createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: 'In transaction' },
        });
        await tx.saveChunk(chunk);
        return chunk.id;
      });

      const retrieved = await storage.getChunk(result);
      expect(retrieved).not.toBeNull();
    });
  });

  describe('Lifecycle', () => {
    it('should clear all data', async () => {
      const storage = new InMemoryStorageProvider();

      await storage.saveThread(createThread());
      await storage.saveChunk(
        createChunk({
          type: ChunkType.AGENT,
          content: { type: ChunkContentType.TEXT, text: 'Test' },
        }),
      );
      await storage.saveState(createState({ threadId: 'thread_1' }));

      storage.clear();

      const thread = await storage.getThread('thread_1');
      expect(thread).toBeNull();
    });
  });
});
