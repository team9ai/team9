/**
 * Todo Component Types
 * Type definitions for todo management
 */

import type { BaseEvent } from '../../../types/base-event.types.js';

// ============ Event Types ============

/**
 * Todo event type enum values for this component
 */
export const TodoEventType = {
  TODO_SET: 'TODO_SET',
  TODO_COMPLETED: 'TODO_COMPLETED',
  TODO_EXPANDED: 'TODO_EXPANDED',
  TODO_UPDATED: 'TODO_UPDATED',
  TODO_DELETED: 'TODO_DELETED',
} as const;

export type TodoEventTypeValue =
  (typeof TodoEventType)[keyof typeof TodoEventType];

// ============ Component Types ============

/**
 * Todo item status
 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

/**
 * Todo item structure
 */
export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  parentId?: string;
  children?: TodoItem[];
}

// ============ Event Interfaces ============

export interface TodoSetEvent extends BaseEvent<typeof TodoEventType.TODO_SET> {
  /** The complete todo list */
  todos: TodoItem[];
}

export interface TodoCompletedEvent extends BaseEvent<
  typeof TodoEventType.TODO_COMPLETED
> {
  /** ID of the todo to mark as completed */
  todoId: string;
}

export interface TodoExpandedEvent extends BaseEvent<
  typeof TodoEventType.TODO_EXPANDED
> {
  /** ID of the todo to expand */
  todoId: string;
  /** Sub-items to add */
  subItems: TodoItem[];
}

export interface TodoUpdatedEvent extends BaseEvent<
  typeof TodoEventType.TODO_UPDATED
> {
  /** ID of the todo to update */
  todoId: string;
  /** New content */
  content?: string;
  /** New status */
  status?: TodoStatus;
}

export interface TodoDeletedEvent extends BaseEvent<
  typeof TodoEventType.TODO_DELETED
> {
  /** ID of the todo to delete */
  todoId: string;
}

/** Union of all todo events */
export type TodoEvent =
  | TodoSetEvent
  | TodoCompletedEvent
  | TodoExpandedEvent
  | TodoUpdatedEvent
  | TodoDeletedEvent;
