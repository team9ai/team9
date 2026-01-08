import { MemoryState } from '../../types/state.types.js';
import {
  ChunkType,
  ChunkRetentionStrategy,
  ChunkContentType,
  MemoryChunk,
} from '../../types/chunk.types.js';
import { Operation } from '../../types/operation.types.js';
import {
  AgentEvent,
  EventType,
  TaskCompletedEvent,
  TaskAbandonedEvent,
  TaskTerminatedEvent,
  TodoSetEvent,
  TodoCompletedEvent,
  TodoExpandedEvent,
  TodoUpdatedEvent,
  TodoDeletedEvent,
  MemoryMarkCriticalEvent,
  MemoryForgetEvent,
} from '../../types/event.types.js';
import { EventReducer, ReducerResult } from '../reducer.types.js';
import { createChunk, deriveChunk } from '../../factories/chunk.factory.js';
import {
  createAddOperation,
  createUpdateOperation,
  createDeleteOperation,
} from '../../factories/operation.factory.js';

/**
 * Find the current WORKING_HISTORY container chunk in state
 */
function findWorkingHistoryChunk(state: MemoryState): MemoryChunk | undefined {
  for (const chunkId of state.chunkIds) {
    const chunk = state.chunks.get(chunkId);
    if (chunk?.type === ChunkType.WORKING_HISTORY) {
      return chunk;
    }
  }
  return undefined;
}

/**
 * Create a conversation chunk and add it to working history
 */
function createConversationResult(
  state: MemoryState,
  chunkType: ChunkType,
  content: Record<string, unknown>,
  eventMeta: { eventType: string; timestamp: number; [key: string]: unknown },
  retentionStrategy?: ChunkRetentionStrategy,
): ReducerResult {
  // Create the conversation chunk
  const conversationChunk = createChunk({
    type: chunkType,
    content: {
      type: ChunkContentType.TEXT,
      ...content,
    },
    retentionStrategy,
    custom: eventMeta,
  });

  const existingHistory = findWorkingHistoryChunk(state);

  if (existingHistory) {
    // Update existing WORKING_HISTORY to add the new child ID
    const updatedHistory = deriveChunk(existingHistory, {
      parentIds: [existingHistory.id],
    });

    // Create updated history with new childIds
    const historyWithNewChild: MemoryChunk = {
      ...updatedHistory,
      childIds: [...(existingHistory.childIds || []), conversationChunk.id],
    };

    return {
      operations: [
        createAddOperation(conversationChunk.id),
        createUpdateOperation(existingHistory.id, historyWithNewChild.id),
      ],
      chunks: [conversationChunk, historyWithNewChild],
    };
  } else {
    // Create new WORKING_HISTORY container with this chunk as first child
    const historyChunk = createChunk({
      type: ChunkType.WORKING_HISTORY,
      content: {
        type: ChunkContentType.TEXT,
        text: '',
      },
    });

    // Add childIds to the history chunk
    const historyWithChild: MemoryChunk = {
      ...historyChunk,
      childIds: [conversationChunk.id],
    };

    return {
      operations: [
        createAddOperation(conversationChunk.id),
        createAddOperation(historyWithChild.id),
      ],
      chunks: [conversationChunk, historyWithChild],
    };
  }
}

// ============ Task Lifecycle Reducers ============

/**
 * Reducer for TASK_COMPLETED events
 */
export class TaskCompletedReducer implements EventReducer<TaskCompletedEvent> {
  readonly eventTypes = [EventType.TASK_COMPLETED];

  canHandle(event: AgentEvent): event is TaskCompletedEvent {
    return event.type === EventType.TASK_COMPLETED;
  }

  reduce(_state: MemoryState, event: TaskCompletedEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.OUTPUT,
      content: {
        type: ChunkContentType.TEXT,
        action: 'task_completed',
        result: event.result,
        summary: event.summary,
      },
      retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      custom: {
        eventType: event.type,
        timestamp: event.timestamp,
      },
    });

    const addOperation = createAddOperation(chunk.id);

    return {
      operations: [addOperation],
      chunks: [chunk],
    };
  }
}

/**
 * Reducer for TASK_ABANDONED events
 */
export class TaskAbandonedReducer implements EventReducer<TaskAbandonedEvent> {
  readonly eventTypes = [EventType.TASK_ABANDONED];

  canHandle(event: AgentEvent): event is TaskAbandonedEvent {
    return event.type === EventType.TASK_ABANDONED;
  }

  reduce(_state: MemoryState, event: TaskAbandonedEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.OUTPUT,
      content: {
        type: ChunkContentType.TEXT,
        action: 'task_abandoned',
        reason: event.reason,
        partialResult: event.partialResult,
      },
      retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      custom: {
        eventType: event.type,
        timestamp: event.timestamp,
      },
    });

    const addOperation = createAddOperation(chunk.id);

    return {
      operations: [addOperation],
      chunks: [chunk],
    };
  }
}

/**
 * Reducer for TASK_TERMINATED events
 */
export class TaskTerminatedReducer implements EventReducer<TaskTerminatedEvent> {
  readonly eventTypes = [EventType.TASK_TERMINATED];

  canHandle(event: AgentEvent): event is TaskTerminatedEvent {
    return event.type === EventType.TASK_TERMINATED;
  }

  reduce(_state: MemoryState, event: TaskTerminatedEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.OUTPUT,
      content: {
        type: ChunkContentType.TEXT,
        action: 'task_terminated',
        terminatedBy: event.terminatedBy,
        reason: event.reason,
      },
      retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      custom: {
        eventType: event.type,
        timestamp: event.timestamp,
      },
    });

    const addOperation = createAddOperation(chunk.id);

    return {
      operations: [addOperation],
      chunks: [chunk],
    };
  }
}

// ============ TODO Management Reducers ============

/**
 * Reducer for TODO_SET events
 */
export class TodoSetReducer implements EventReducer<TodoSetEvent> {
  readonly eventTypes = [EventType.TODO_SET];

  canHandle(event: AgentEvent): event is TodoSetEvent {
    return event.type === EventType.TODO_SET;
  }

  reduce(state: MemoryState, event: TodoSetEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.THINKING,
      {
        action: 'todo_set',
        todos: event.todos,
      },
      {
        eventType: event.type,
        timestamp: event.timestamp,
        category: 'todo',
      },
      ChunkRetentionStrategy.CRITICAL,
    );
  }
}

/**
 * Reducer for TODO_COMPLETED events
 */
export class TodoCompletedReducer implements EventReducer<TodoCompletedEvent> {
  readonly eventTypes = [EventType.TODO_COMPLETED];

  canHandle(event: AgentEvent): event is TodoCompletedEvent {
    return event.type === EventType.TODO_COMPLETED;
  }

  reduce(state: MemoryState, event: TodoCompletedEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.THINKING,
      {
        action: 'todo_completed',
        todoId: event.todoId,
        result: event.result,
      },
      {
        eventType: event.type,
        timestamp: event.timestamp,
        category: 'todo',
      },
      ChunkRetentionStrategy.COMPRESSIBLE,
    );
  }
}

/**
 * Reducer for TODO_EXPANDED events
 */
export class TodoExpandedReducer implements EventReducer<TodoExpandedEvent> {
  readonly eventTypes = [EventType.TODO_EXPANDED];

  canHandle(event: AgentEvent): event is TodoExpandedEvent {
    return event.type === EventType.TODO_EXPANDED;
  }

  reduce(state: MemoryState, event: TodoExpandedEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.THINKING,
      {
        action: 'todo_expanded',
        todoId: event.todoId,
        subItems: event.subItems,
      },
      {
        eventType: event.type,
        timestamp: event.timestamp,
        category: 'todo',
      },
      ChunkRetentionStrategy.COMPRESSIBLE,
    );
  }
}

/**
 * Reducer for TODO_UPDATED events
 */
export class TodoUpdatedReducer implements EventReducer<TodoUpdatedEvent> {
  readonly eventTypes = [EventType.TODO_UPDATED];

  canHandle(event: AgentEvent): event is TodoUpdatedEvent {
    return event.type === EventType.TODO_UPDATED;
  }

  reduce(state: MemoryState, event: TodoUpdatedEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.THINKING,
      {
        action: 'todo_updated',
        todoId: event.todoId,
        content: event.content,
        status: event.status,
      },
      {
        eventType: event.type,
        timestamp: event.timestamp,
        category: 'todo',
      },
      ChunkRetentionStrategy.DISPOSABLE,
    );
  }
}

/**
 * Reducer for TODO_DELETED events
 */
export class TodoDeletedReducer implements EventReducer<TodoDeletedEvent> {
  readonly eventTypes = [EventType.TODO_DELETED];

  canHandle(event: AgentEvent): event is TodoDeletedEvent {
    return event.type === EventType.TODO_DELETED;
  }

  reduce(state: MemoryState, event: TodoDeletedEvent): ReducerResult {
    return createConversationResult(
      state,
      ChunkType.THINKING,
      {
        action: 'todo_deleted',
        todoId: event.todoId,
      },
      {
        eventType: event.type,
        timestamp: event.timestamp,
        category: 'todo',
      },
      ChunkRetentionStrategy.DISPOSABLE,
    );
  }
}

// ============ Memory Management Reducers ============

/**
 * Reducer for MEMORY_MARK_CRITICAL events
 * Updates existing chunks to have CRITICAL retention strategy
 */
export class MemoryMarkCriticalReducer implements EventReducer<MemoryMarkCriticalEvent> {
  readonly eventTypes = [EventType.MEMORY_MARK_CRITICAL];

  canHandle(event: AgentEvent): event is MemoryMarkCriticalEvent {
    return event.type === EventType.MEMORY_MARK_CRITICAL;
  }

  reduce(state: MemoryState, event: MemoryMarkCriticalEvent): ReducerResult {
    const operations: Operation[] = [];
    const chunks: ReducerResult['chunks'] = [];

    for (const chunkId of event.chunkIds) {
      const existingChunk = state.chunks.get(chunkId);
      if (existingChunk) {
        const updatedChunk = deriveChunk(existingChunk, {
          retentionStrategy: ChunkRetentionStrategy.CRITICAL,
        });

        operations.push(createUpdateOperation(chunkId, updatedChunk.id));
        chunks.push(updatedChunk);
      }
    }

    return { operations, chunks };
  }
}

/**
 * Reducer for MEMORY_FORGET events
 * Deletes specified chunks from memory
 */
export class MemoryForgetReducer implements EventReducer<MemoryForgetEvent> {
  readonly eventTypes = [EventType.MEMORY_FORGET];

  canHandle(event: AgentEvent): event is MemoryForgetEvent {
    return event.type === EventType.MEMORY_FORGET;
  }

  reduce(state: MemoryState, event: MemoryForgetEvent): ReducerResult {
    const operations: Operation[] = [];

    for (const chunkId of event.chunkIds) {
      if (state.chunks.has(chunkId)) {
        operations.push(createDeleteOperation(chunkId));
      }
    }

    return { operations, chunks: [] };
  }
}
