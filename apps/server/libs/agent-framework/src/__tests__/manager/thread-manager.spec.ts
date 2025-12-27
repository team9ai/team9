/**
 * Unit tests for ThreadManager
 */
import { ThreadManager } from '../../manager/thread.manager.js';
import { InMemoryStorageProvider } from '../../storage/index.js';
import { createChunk, createAddOperation } from '../../factories/index.js';
import { ChunkType, ChunkContentType } from '../../types/index.js';

describe('ThreadManager', () => {
  let storage: InMemoryStorageProvider;
  let manager: ThreadManager;

  beforeEach(() => {
    storage = new InMemoryStorageProvider();
    manager = new ThreadManager(storage);
  });

  describe('createThread', () => {
    it('should create a thread with initial empty state', async () => {
      const result = await manager.createThread();

      expect(result.thread).toBeDefined();
      expect(result.thread.id).toBeDefined();
      expect(result.initialState).toBeDefined();
      expect(result.initialState.threadId).toBe(result.thread.id);
      expect(result.thread.currentStateId).toBe(result.initialState.id);
      expect(result.thread.initialStateId).toBe(result.initialState.id);
    });

    it('should create a thread with custom metadata', async () => {
      const result = await manager.createThread({
        custom: { agentId: 'agent_1', sessionId: 'session_1' },
      });

      expect(result.thread.metadata.custom?.agentId).toBe('agent_1');
      expect(result.thread.metadata.custom?.sessionId).toBe('session_1');
    });

    it('should create a thread with initial chunks', async () => {
      const chunk = createChunk({
        type: ChunkType.SYSTEM,
        content: { type: ChunkContentType.TEXT, text: 'System prompt' },
      });

      const result = await manager.createThread({
        initialChunks: [chunk],
      });

      expect(result.initialState.chunks.size).toBe(1);
      expect(result.initialState.chunks.get(chunk.id)).toBeDefined();
    });

    it('should persist thread to storage', async () => {
      const result = await manager.createThread();

      const retrieved = await storage.getThread(result.thread.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(result.thread.id);
    });
  });

  describe('getThread', () => {
    it('should retrieve existing thread', async () => {
      const { thread } = await manager.createThread();

      const retrieved = await manager.getThread(thread.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(thread.id);
    });

    it('should return null for non-existent thread', async () => {
      const retrieved = await manager.getThread('non_existent');

      expect(retrieved).toBeNull();
    });
  });

  describe('getCurrentState', () => {
    it('should get current state of thread', async () => {
      const { thread, initialState } = await manager.createThread();

      const currentState = await manager.getCurrentState(thread.id);

      expect(currentState).not.toBeNull();
      expect(currentState?.id).toBe(initialState.id);
    });

    it('should return null for non-existent thread', async () => {
      const currentState = await manager.getCurrentState('non_existent');

      expect(currentState).toBeNull();
    });
  });

  describe('getInitialState', () => {
    it('should get initial state of thread', async () => {
      const { thread, initialState } = await manager.createThread();

      const retrieved = await manager.getInitialState(thread.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe(initialState.id);
    });
  });

  describe('getStateHistory', () => {
    it('should get all states for a thread', async () => {
      const { thread } = await manager.createThread();

      // Add more states by applying operations
      const chunk = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: 'Hello', role: 'user' },
      });

      await manager.applyOperations(
        thread.id,
        [createAddOperation(chunk.id)],
        [chunk],
      );

      const history = await manager.getStateHistory(thread.id);

      expect(history.length).toBe(2);
    });
  });

  describe('applyReducerResult', () => {
    it('should apply reducer result and update state', async () => {
      const { thread } = await manager.createThread();

      const chunk = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: 'Hello', role: 'user' },
      });

      const result = await manager.applyReducerResult(thread.id, {
        operations: [createAddOperation(chunk.id)],
        chunks: [chunk],
      });

      expect(result.state.chunks.size).toBe(1);
      expect(result.addedChunks.length).toBe(1);
      expect(result.thread.currentStateId).toBe(result.state.id);
    });

    it('should throw error for non-existent thread', async () => {
      const chunk = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: 'Hello', role: 'user' },
      });

      await expect(
        manager.applyReducerResult('non_existent', {
          operations: [createAddOperation(chunk.id)],
          chunks: [chunk],
        }),
      ).rejects.toThrow('Thread not found');
    });
  });

  describe('applyOperations', () => {
    it('should apply operations directly', async () => {
      const { thread } = await manager.createThread();

      const chunk = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: 'Test', role: 'user' },
      });

      const result = await manager.applyOperations(
        thread.id,
        [createAddOperation(chunk.id)],
        [chunk],
      );

      expect(result.state.chunks.size).toBe(1);
    });
  });

  describe('deleteThread', () => {
    it('should delete thread and all associated data', async () => {
      const chunk = createChunk({
        type: ChunkType.SYSTEM,
        content: { type: ChunkContentType.TEXT, text: 'System' },
      });

      const { thread } = await manager.createThread({
        initialChunks: [chunk],
      });

      await manager.deleteThread(thread.id);

      const retrieved = await manager.getThread(thread.id);
      expect(retrieved).toBeNull();

      const state = await manager.getCurrentState(thread.id);
      expect(state).toBeNull();
    });
  });
});
