/**
 * Todo Component Reducers
 * Reducer functions for todo events
 */

import type { MemoryState } from '../../../types/state.types.js';
import type {
  AgentEvent,
  TodoItem,
  TodoSetEvent,
  TodoCompletedEvent,
  TodoExpandedEvent,
  TodoUpdatedEvent,
  TodoDeletedEvent,
} from '../../../types/event.types.js';
import type { ReducerResult } from '../../../reducer/reducer.types.js';
import type { ComponentContext } from '../../component.interface.js';
import {
  createTodoSetResult,
  createTodoUpdateResult,
} from './todo.operations.js';
import {
  formatTodos,
  updateTodoStatus,
  updateTodoItem,
  expandTodo,
  deleteTodo,
} from './todo.helpers.js';

/**
 * Reduce TODO_SET event
 */
export function reduceTodoSet(
  componentId: string,
  state: MemoryState,
  event: AgentEvent,
  context: ComponentContext,
): ReducerResult {
  const todoEvent = event as TodoSetEvent;

  // Update component data
  context.setData('todos', todoEvent.todos);

  return createTodoSetResult(componentId, state, todoEvent.todos, formatTodos);
}

/**
 * Reduce TODO_COMPLETED event
 */
export function reduceTodoCompleted(
  componentId: string,
  state: MemoryState,
  event: AgentEvent,
  context: ComponentContext,
): ReducerResult {
  const todoEvent = event as TodoCompletedEvent;
  const todos = context.getData<TodoItem[]>('todos') ?? [];

  // Update the specific todo
  const updatedTodos = updateTodoStatus(todos, todoEvent.todoId, 'completed');
  context.setData('todos', updatedTodos);

  return createTodoUpdateResult(componentId, state, updatedTodos, formatTodos);
}

/**
 * Reduce TODO_EXPANDED event
 */
export function reduceTodoExpanded(
  componentId: string,
  state: MemoryState,
  event: AgentEvent,
  context: ComponentContext,
): ReducerResult {
  const todoEvent = event as TodoExpandedEvent;
  const todos = context.getData<TodoItem[]>('todos') ?? [];

  // Add sub-items to the specified todo
  const updatedTodos = expandTodo(todos, todoEvent.todoId, todoEvent.subItems);
  context.setData('todos', updatedTodos);

  return createTodoUpdateResult(componentId, state, updatedTodos, formatTodos);
}

/**
 * Reduce TODO_UPDATED event
 */
export function reduceTodoUpdated(
  componentId: string,
  state: MemoryState,
  event: AgentEvent,
  context: ComponentContext,
): ReducerResult {
  const todoEvent = event as TodoUpdatedEvent;
  const todos = context.getData<TodoItem[]>('todos') ?? [];

  // Update the specific todo
  const updatedTodos = updateTodoItem(
    todos,
    todoEvent.todoId,
    todoEvent.content,
    todoEvent.status,
  );
  context.setData('todos', updatedTodos);

  return createTodoUpdateResult(componentId, state, updatedTodos, formatTodos);
}

/**
 * Reduce TODO_DELETED event
 */
export function reduceTodoDeleted(
  componentId: string,
  state: MemoryState,
  event: AgentEvent,
  context: ComponentContext,
): ReducerResult {
  const todoEvent = event as TodoDeletedEvent;
  const todos = context.getData<TodoItem[]>('todos') ?? [];

  // Remove the specific todo
  const updatedTodos = deleteTodo(todos, todoEvent.todoId);
  context.setData('todos', updatedTodos);

  return createTodoUpdateResult(componentId, state, updatedTodos, formatTodos);
}
