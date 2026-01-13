/**
 * Todo Component Helpers
 * Helper functions for todo manipulation
 */

import type { TodoItem } from './todo.types.js';

/**
 * Format todos as text for display
 */
export function formatTodos(todos: TodoItem[], indent = 0): string {
  const lines: string[] = [];
  const prefix = '  '.repeat(indent);

  for (const todo of todos) {
    const statusIcon = getStatusIcon(todo.status);
    lines.push(`${prefix}${statusIcon} ${todo.content}`);

    if (todo.children && todo.children.length > 0) {
      lines.push(formatTodos(todo.children, indent + 1));
    }
  }

  return lines.join('\n');
}

/**
 * Get status icon for a todo status
 */
export function getStatusIcon(status: TodoItem['status']): string {
  switch (status) {
    case 'completed':
      return '[x]';
    case 'in_progress':
      return '[>]';
    case 'cancelled':
      return '[-]';
    case 'pending':
    default:
      return '[ ]';
  }
}

/**
 * Update the status of a todo by ID
 */
export function updateTodoStatus(
  todos: TodoItem[],
  todoId: string,
  status: TodoItem['status'],
): TodoItem[] {
  return todos.map((todo) => {
    if (todo.id === todoId) {
      return { ...todo, status };
    }
    if (todo.children) {
      return {
        ...todo,
        children: updateTodoStatus(todo.children, todoId, status),
      };
    }
    return todo;
  });
}

/**
 * Update a todo item by ID
 */
export function updateTodoItem(
  todos: TodoItem[],
  todoId: string,
  content?: string,
  status?: TodoItem['status'],
): TodoItem[] {
  return todos.map((todo) => {
    if (todo.id === todoId) {
      return {
        ...todo,
        ...(content !== undefined && { content }),
        ...(status !== undefined && { status }),
      };
    }
    if (todo.children) {
      return {
        ...todo,
        children: updateTodoItem(todo.children, todoId, content, status),
      };
    }
    return todo;
  });
}

/**
 * Expand a todo with sub-items
 */
export function expandTodo(
  todos: TodoItem[],
  todoId: string,
  subItems: TodoItem[],
): TodoItem[] {
  return todos.map((todo) => {
    if (todo.id === todoId) {
      return {
        ...todo,
        children: [...(todo.children ?? []), ...subItems],
      };
    }
    if (todo.children) {
      return { ...todo, children: expandTodo(todo.children, todoId, subItems) };
    }
    return todo;
  });
}

/**
 * Delete a todo by ID
 */
export function deleteTodo(todos: TodoItem[], todoId: string): TodoItem[] {
  return todos
    .filter((todo) => todo.id !== todoId)
    .map((todo) => {
      if (todo.children) {
        return { ...todo, children: deleteTodo(todo.children, todoId) };
      }
      return todo;
    });
}
