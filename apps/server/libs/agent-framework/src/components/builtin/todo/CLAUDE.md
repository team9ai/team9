# Todo Component

Pluggable component for task/todo list management. Handles todo creation, completion, expansion, and deletion.

## Overview

The Todo component manages a hierarchical task list that the agent can use to track progress on complex tasks.

## Component Details

| Property | Value                                 |
| -------- | ------------------------------------- |
| ID       | `builtin:todo`                        |
| Name     | Todo Manager                          |
| Type     | `pluggable` (can be enabled/disabled) |

## Todo Item Structure

```typescript
interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  parentId?: string; // For nested todos
  children?: TodoItem[];
}
```

## Handled Events

| Event Type       | Description                    |
| ---------------- | ------------------------------ |
| `TODO_SET`       | Replace entire todo list       |
| `TODO_COMPLETED` | Mark a todo as completed       |
| `TODO_EXPANDED`  | Add sub-todos to a todo        |
| `TODO_UPDATED`   | Update a todo's content/status |
| `TODO_DELETED`   | Remove a todo                  |

## Usage

### Blueprint Configuration

```typescript
const blueprint: Blueprint = {
  name: 'Task Agent',
  components: [{ component: TodoComponent }],
};
```

### Triggering Events

```typescript
// Set todos
await manager.processEvent({
  type: EventType.TODO_SET,
  todos: [
    { id: '1', content: 'First task', status: 'pending' },
    { id: '2', content: 'Second task', status: 'pending' },
  ],
});

// Complete a todo
await manager.processEvent({
  type: EventType.TODO_COMPLETED,
  todoId: '1',
});
```

## Rendering

Todos are rendered in the system prompt with status indicators:

```
<todos>
Current Tasks:
  [ ] Task 1
  [>] Task 2 (in progress)
  [✓] Task 3 (completed)
</todos>
```

- Location: `system` prompt
- Order: 800 (dynamic content range)

## Files

| File                 | Description                      |
| -------------------- | -------------------------------- |
| `todo.component.ts`  | `TodoComponent` class            |
| `todo.types.ts`      | Type definitions                 |
| `todo.operations.ts` | Chunk creation/update operations |
| `todo.reducers.ts`   | Event reducer functions          |
| `todo.helpers.ts`    | Formatting and utility functions |
| `index.ts`           | Public exports                   |

## Key Operations

### createTodoChunk

Creates a TODO chunk with initial content.

### findTodoChunk

Finds the TODO chunk in state.

### formatTodos

Formats todo items for display.

## Exports

```typescript
export { TodoComponent } from './todo.component';
export type { TodoItem } from './todo.types';
export {
  TODO_CHUNK_KEY,
  findTodoChunk,
  createTodoChunk,
  createTodoSetResult,
  createTodoUpdateResult,
} from './todo.operations';
export {
  reduceTodoSet,
  reduceTodoCompleted,
  reduceTodoExpanded,
  reduceTodoUpdated,
  reduceTodoDeleted,
} from './todo.reducers';
export {
  formatTodos,
  getStatusIcon,
  updateTodoStatus,
  updateTodoItem,
  expandTodo,
  deleteTodo,
} from './todo.helpers';
```
