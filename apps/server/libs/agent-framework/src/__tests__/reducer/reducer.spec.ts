/**
 * Unit tests for reducer module
 */
import {
  EventType,
  ChunkType,
  UserMessageEvent,
  LLMTextResponseEvent,
  LLMToolCallEvent,
  ToolResultEvent,
  ToolErrorEvent,
  TodoSetEvent,
  TaskCompletedEvent,
  MemoryMarkCriticalEvent,
  MemoryForgetEvent,
  ChunkRetentionStrategy,
  ChunkContentType,
} from '../../types/index.js';
import { createState, createChunk } from '../../factories/index.js';
import {
  createDefaultReducerRegistry,
  DefaultReducerRegistry,
  UserMessageReducer,
  LLMTextResponseReducer,
  LLMToolCallReducer,
  ToolResultReducer,
  ToolErrorReducer,
  TodoSetReducer,
  TaskCompletedReducer,
  MemoryMarkCriticalReducer,
  MemoryForgetReducer,
} from '../../reducer/index.js';

describe('Reducer Module', () => {
  describe('ReducerRegistry', () => {
    it('should register all default reducers', () => {
      const registry = createDefaultReducerRegistry() as DefaultReducerRegistry;
      const reducers = registry.getAllReducers();

      expect(reducers.length).toBeGreaterThanOrEqual(20);
    });

    it('should find correct reducer for event', () => {
      const registry = createDefaultReducerRegistry() as DefaultReducerRegistry;

      const event: UserMessageEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Hello',
      };

      const reducers = registry.getReducersForEvent(event);
      expect(reducers.length).toBeGreaterThan(0);
    });

    it('should handle events with no reducer gracefully', async () => {
      const registry = createDefaultReducerRegistry();
      const state = createState({ threadId: 'thread_1' });

      const result = await registry.reduce(state, {
        type: 'UNKNOWN_EVENT' as EventType,
        timestamp: Date.now(),
      } as unknown as UserMessageEvent);

      expect(result.operations.length).toBe(0);
      expect(result.chunks.length).toBe(0);
    });
  });

  describe('UserMessageReducer', () => {
    it('should handle USER_MESSAGE event', async () => {
      const reducer = new UserMessageReducer();
      const state = createState({ threadId: 'thread_1' });

      const event: UserMessageEvent = {
        type: EventType.USER_MESSAGE,
        timestamp: Date.now(),
        content: 'Hello, world!',
      };

      expect(reducer.canHandle(event)).toBe(true);

      const result = await reducer.reduce(state, event);

      expect(result.operations.length).toBe(1);
      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].type).toBe(ChunkType.WORKING_FLOW);
    });
  });

  describe('LLMTextResponseReducer', () => {
    it('should handle LLM_TEXT_RESPONSE event', async () => {
      const reducer = new LLMTextResponseReducer();
      const state = createState({ threadId: 'thread_1' });

      const event: LLMTextResponseEvent = {
        type: EventType.LLM_TEXT_RESPONSE,
        timestamp: Date.now(),
        content: 'I can help you with that.',
      };

      expect(reducer.canHandle(event)).toBe(true);

      const result = await reducer.reduce(state, event);

      expect(result.chunks[0].type).toBe(ChunkType.AGENT);
      const content = result.chunks[0].content as { role?: string };
      expect(content.role).toBe('assistant');
    });
  });

  describe('LLMToolCallReducer', () => {
    it('should handle LLM_TOOL_CALL event', async () => {
      const reducer = new LLMToolCallReducer();
      const state = createState({ threadId: 'thread_1' });

      const event: LLMToolCallEvent = {
        type: EventType.LLM_TOOL_CALL,
        timestamp: Date.now(),
        toolName: 'read_file',
        callId: 'call_123',
        arguments: { path: '/src/main.ts' },
      };

      expect(reducer.canHandle(event)).toBe(true);

      const result = await reducer.reduce(state, event);

      expect(result.chunks[0].type).toBe(ChunkType.WORKFLOW);
      const content = result.chunks[0].content as {
        toolName?: string;
        callId?: string;
      };
      expect(content.toolName).toBe('read_file');
      expect(content.callId).toBe('call_123');
    });
  });

  describe('ToolResultReducer', () => {
    it('should handle TOOL_RESULT event', async () => {
      const reducer = new ToolResultReducer();
      const state = createState({ threadId: 'thread_1' });

      const event: ToolResultEvent = {
        type: EventType.TOOL_RESULT,
        timestamp: Date.now(),
        toolName: 'read_file',
        callId: 'call_123',
        result: 'File content here',
        success: true,
      };

      expect(reducer.canHandle(event)).toBe(true);

      const result = await reducer.reduce(state, event);

      expect(result.chunks[0].type).toBe(ChunkType.ENVIRONMENT);
    });
  });

  describe('ToolErrorReducer', () => {
    it('should handle TOOL_ERROR event', async () => {
      const reducer = new ToolErrorReducer();
      const state = createState({ threadId: 'thread_1' });

      const event: ToolErrorEvent = {
        type: EventType.TOOL_ERROR,
        timestamp: Date.now(),
        toolName: 'read_file',
        callId: 'call_123',
        error: 'File not found',
      };

      expect(reducer.canHandle(event)).toBe(true);

      const result = await reducer.reduce(state, event);

      expect(result.chunks[0].type).toBe(ChunkType.ENVIRONMENT);
    });
  });

  describe('TodoSetReducer', () => {
    it('should handle TODO_SET event', async () => {
      const reducer = new TodoSetReducer();
      const state = createState({ threadId: 'thread_1' });

      const event: TodoSetEvent = {
        type: EventType.TODO_SET,
        timestamp: Date.now(),
        todos: [
          { id: '1', content: 'Task 1', status: 'pending' },
          { id: '2', content: 'Task 2', status: 'in_progress' },
        ],
      };

      expect(reducer.canHandle(event)).toBe(true);

      const result = await reducer.reduce(state, event);

      expect(result.chunks[0].type).toBe(ChunkType.WORKING_FLOW);
    });
  });

  describe('TaskCompletedReducer', () => {
    it('should handle TASK_COMPLETED event', async () => {
      const reducer = new TaskCompletedReducer();
      const state = createState({ threadId: 'thread_1' });

      const event: TaskCompletedEvent = {
        type: EventType.TASK_COMPLETED,
        timestamp: Date.now(),
        result: 'Task completed successfully',
        summary: 'All steps done',
      };

      expect(reducer.canHandle(event)).toBe(true);

      const result = await reducer.reduce(state, event);

      expect(result.chunks[0].type).toBe(ChunkType.OUTPUT);
      expect(result.chunks[0].retentionStrategy).toBe(
        ChunkRetentionStrategy.CRITICAL,
      );
    });
  });

  describe('MemoryMarkCriticalReducer', () => {
    it('should handle MEMORY_MARK_CRITICAL event', async () => {
      const reducer = new MemoryMarkCriticalReducer();

      const chunk = createChunk({
        type: ChunkType.WORKING_FLOW,
        content: { type: ChunkContentType.TEXT, text: 'Important info' },
        retentionStrategy: ChunkRetentionStrategy.DISPOSABLE,
      });

      const state = createState({ threadId: 'thread_1', chunks: [chunk] });

      const event: MemoryMarkCriticalEvent = {
        type: EventType.MEMORY_MARK_CRITICAL,
        timestamp: Date.now(),
        chunkIds: [chunk.id],
      };

      expect(reducer.canHandle(event)).toBe(true);

      const result = await reducer.reduce(state, event);

      expect(result.chunks.length).toBe(1);
      expect(result.chunks[0].retentionStrategy).toBe(
        ChunkRetentionStrategy.CRITICAL,
      );
    });
  });

  describe('MemoryForgetReducer', () => {
    it('should handle MEMORY_FORGET event', async () => {
      const reducer = new MemoryForgetReducer();

      const chunk = createChunk({
        type: ChunkType.WORKING_FLOW,
        content: { type: ChunkContentType.TEXT, text: 'To be forgotten' },
      });

      const state = createState({ threadId: 'thread_1', chunks: [chunk] });

      const event: MemoryForgetEvent = {
        type: EventType.MEMORY_FORGET,
        timestamp: Date.now(),
        chunkIds: [chunk.id],
      };

      expect(reducer.canHandle(event)).toBe(true);

      const result = await reducer.reduce(state, event);

      expect(result.operations.length).toBe(1);
    });
  });

  describe('Integration', () => {
    it('should process full reduce cycle through registry', async () => {
      const registry = createDefaultReducerRegistry();
      const state = createState({ threadId: 'thread_1' });

      const events = [
        {
          type: EventType.USER_MESSAGE,
          timestamp: Date.now(),
          content: 'Hello',
        } as UserMessageEvent,
        {
          type: EventType.LLM_TEXT_RESPONSE,
          timestamp: Date.now(),
          content: 'Hi there',
        } as LLMTextResponseEvent,
      ];

      let totalOps = 0;
      let totalChunks = 0;

      for (const event of events) {
        const result = await registry.reduce(state, event);
        totalOps += result.operations.length;
        totalChunks += result.chunks.length;
      }

      expect(totalOps).toBe(2);
      expect(totalChunks).toBe(2);
    });
  });
});
