/**
 * TodoComponent - Pluggable component for task/todo management
 * Handles TODO_SET, TODO_COMPLETED, TODO_EXPANDED, TODO_UPDATED, TODO_DELETED events
 *
 * Architecture:
 * - Creates TODO chunks for task tracking
 * - Maintains a tree structure of todos in component data
 * - Renders current todos in system prompt (dynamic, order 800)
 */

import { AbstractComponent } from '../../base/abstract-component.js';
import type { MemoryChunk } from '../../../types/chunk.types.js';
import {
  ChunkType,
  ChunkContentType,
  ChunkRetentionStrategy,
} from '../../../types/chunk.types.js';
import type { AgentEvent, TodoItem } from '../../../types/event.types.js';
import { EventType } from '../../../types/event.types.js';
import type {
  NewComponentType,
  ComponentContext,
  ComponentReducerFn,
  RenderedFragment,
} from '../../component.interface.js';
import { createChunk } from '../../../factories/chunk.factory.js';
import { TODO_CHUNK_KEY } from './todo.operations.js';
import {
  reduceTodoSet,
  reduceTodoCompleted,
  reduceTodoExpanded,
  reduceTodoUpdated,
  reduceTodoDeleted,
} from './todo.reducers.js';
import { formatTodos } from './todo.helpers.js';

/**
 * TodoComponent manages task lists and progress tracking
 * This is a pluggable component that can be enabled/disabled at runtime
 */
export class TodoComponent extends AbstractComponent {
  readonly id = 'builtin:todo';
  readonly name = 'Todo Manager';
  readonly type: NewComponentType = 'pluggable';

  private static readonly HANDLED_EVENTS = new Set([
    EventType.TODO_SET,
    EventType.TODO_COMPLETED,
    EventType.TODO_EXPANDED,
    EventType.TODO_UPDATED,
    EventType.TODO_DELETED,
  ]);

  // ============ Lifecycle ============

  onInitialize(context: ComponentContext): void {
    // Initialize empty todo list
    context.setData('todos', [] as TodoItem[]);
  }

  // ============ Chunk Management ============

  createInitialChunks(_context: ComponentContext): MemoryChunk[] {
    return [
      createChunk({
        componentId: this.id,
        chunkKey: TODO_CHUNK_KEY,
        type: ChunkType.SYSTEM,
        content: {
          type: ChunkContentType.TEXT,
          text: '',
          todos: [],
        },
        retentionStrategy: ChunkRetentionStrategy.COMPRESSIBLE,
        custom: {
          isTodoList: true,
        },
      }),
    ];
  }

  // ============ Event Handling ============

  getReducersForEvent(event: AgentEvent): ComponentReducerFn[] {
    if (!TodoComponent.HANDLED_EVENTS.has(event.type)) {
      return [];
    }

    switch (event.type) {
      case EventType.TODO_SET:
        return [(state, evt, ctx) => reduceTodoSet(this.id, state, evt, ctx)];
      case EventType.TODO_COMPLETED:
        return [
          (state, evt, ctx) => reduceTodoCompleted(this.id, state, evt, ctx),
        ];
      case EventType.TODO_EXPANDED:
        return [
          (state, evt, ctx) => reduceTodoExpanded(this.id, state, evt, ctx),
        ];
      case EventType.TODO_UPDATED:
        return [
          (state, evt, ctx) => reduceTodoUpdated(this.id, state, evt, ctx),
        ];
      case EventType.TODO_DELETED:
        return [
          (state, evt, ctx) => reduceTodoDeleted(this.id, state, evt, ctx),
        ];
      default:
        return [];
    }
  }

  // ============ Rendering ============

  renderChunk(
    chunk: MemoryChunk,
    _context: ComponentContext,
  ): RenderedFragment[] {
    if (chunk.componentId !== this.id) {
      return [];
    }

    const content = chunk.content as { todos?: TodoItem[] };
    const todos = content.todos ?? [];

    if (todos.length === 0) {
      return [];
    }

    const text = formatTodos(todos);

    return [
      {
        content: `<current_todos>\n${text}\n</current_todos>`,
        location: 'system',
        order: 800, // Dynamic content, late in system prompt
      },
    ];
  }

  // ============ Public API ============

  /**
   * Get current todos from context
   */
  getTodos(context: ComponentContext): TodoItem[] {
    return context.getData<TodoItem[]>('todos') ?? [];
  }
}
