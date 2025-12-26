import { MemoryState } from '../../types/state.types';
import {
  ChunkType,
  ChunkRetentionStrategy,
  ChunkContentType,
} from '../../types/chunk.types';
import { Operation } from '../../types/operation.types';
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
} from '../../types/event.types';
import { EventReducer, ReducerResult } from '../reducer.types';
import { createChunk, deriveChunk } from '../../factories/chunk.factory';
import {
  createAddOperation,
  createUpdateOperation,
  createDeleteOperation,
} from '../../factories/operation.factory';

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

  reduce(_state: MemoryState, event: TodoSetEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.WORKING_FLOW,
      content: {
        type: ChunkContentType.TEXT,
        action: 'todo_set',
        todos: event.todos,
      },
      retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      custom: {
        eventType: event.type,
        timestamp: event.timestamp,
        subType: 'todo',
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
 * Reducer for TODO_COMPLETED events
 */
export class TodoCompletedReducer implements EventReducer<TodoCompletedEvent> {
  readonly eventTypes = [EventType.TODO_COMPLETED];

  canHandle(event: AgentEvent): event is TodoCompletedEvent {
    return event.type === EventType.TODO_COMPLETED;
  }

  reduce(_state: MemoryState, event: TodoCompletedEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.WORKING_FLOW,
      content: {
        type: ChunkContentType.TEXT,
        action: 'todo_completed',
        todoId: event.todoId,
        result: event.result,
      },
      retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      custom: {
        eventType: event.type,
        timestamp: event.timestamp,
        subType: 'todo',
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
 * Reducer for TODO_EXPANDED events
 */
export class TodoExpandedReducer implements EventReducer<TodoExpandedEvent> {
  readonly eventTypes = [EventType.TODO_EXPANDED];

  canHandle(event: AgentEvent): event is TodoExpandedEvent {
    return event.type === EventType.TODO_EXPANDED;
  }

  reduce(_state: MemoryState, event: TodoExpandedEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.WORKING_FLOW,
      content: {
        type: ChunkContentType.TEXT,
        action: 'todo_expanded',
        todoId: event.todoId,
        subItems: event.subItems,
      },
      retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
      custom: {
        eventType: event.type,
        timestamp: event.timestamp,
        subType: 'todo',
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
 * Reducer for TODO_UPDATED events
 */
export class TodoUpdatedReducer implements EventReducer<TodoUpdatedEvent> {
  readonly eventTypes = [EventType.TODO_UPDATED];

  canHandle(event: AgentEvent): event is TodoUpdatedEvent {
    return event.type === EventType.TODO_UPDATED;
  }

  reduce(_state: MemoryState, event: TodoUpdatedEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.WORKING_FLOW,
      content: {
        type: ChunkContentType.TEXT,
        action: 'todo_updated',
        todoId: event.todoId,
        content: event.content,
        status: event.status,
      },
      retentionStrategy: ChunkRetentionStrategy.DISPOSABLE,
      custom: {
        eventType: event.type,
        timestamp: event.timestamp,
        subType: 'todo',
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
 * Reducer for TODO_DELETED events
 */
export class TodoDeletedReducer implements EventReducer<TodoDeletedEvent> {
  readonly eventTypes = [EventType.TODO_DELETED];

  canHandle(event: AgentEvent): event is TodoDeletedEvent {
    return event.type === EventType.TODO_DELETED;
  }

  reduce(_state: MemoryState, event: TodoDeletedEvent): ReducerResult {
    const chunk = createChunk({
      type: ChunkType.WORKING_FLOW,
      content: {
        type: ChunkContentType.TEXT,
        action: 'todo_deleted',
        todoId: event.todoId,
      },
      retentionStrategy: ChunkRetentionStrategy.DISPOSABLE,
      custom: {
        eventType: event.type,
        timestamp: event.timestamp,
        subType: 'todo',
      },
    });

    const addOperation = createAddOperation(chunk.id);

    return {
      operations: [addOperation],
      chunks: [chunk],
    };
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
