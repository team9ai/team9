# Agent Control Tools

Control tools are special tools that control Agent's own behavior and state, rather than performing external tasks.

## Categories

### Communication Control

| Tool                    | Description                                                   |
| ----------------------- | ------------------------------------------------------------- |
| `request_clarification` | Report that clarification/additional info is needed from user |
| `report_completion`     | Report task completion and return result to parent/user       |
| `report_progress`       | Report intermediate progress update                           |

### Agent Lifecycle Control

| Tool               | Description                                         |
| ------------------ | --------------------------------------------------- |
| `idle_wait`        | Agent enters idle state, waiting for external input |
| `spawn_subagent`   | Create and start a new sub-agent                    |
| `message_subagent` | Send message/instruction to existing sub-agent      |
| `spawn_skill`      | Start a specialized skill agent                     |
| `terminate_self`   | Agent terminates itself                             |

### Task Planning Control

| Tool           | Description                                          |
| -------------- | ---------------------------------------------------- |
| `todo_execute` | Execute JS code to manipulate TODO state (see below) |

#### TODO State Operations

TODO items have the following statuses:

- `pending` - Not yet started
- `in_progress` - Currently being worked on
- `completed` - Finished successfully

The `todo_execute` tool accepts JavaScript code that runs in a restricted sandbox environment. The code can use the following APIs:

```typescript
// Available APIs in sandbox
interface TodoAPI {
  // Mark a TODO as completed
  complete(todoId: string, result?: unknown): void;

  // Delete a TODO item
  delete(todoId: string): void;

  // Update TODO content and/or status
  update(
    todoId: string,
    updates: { content?: string; status?: TodoStatus },
  ): void;

  // Expand a TODO into sub-items
  expand(todoId: string, subItems: { id: string; content: string }[]): void;

  // Replace entire TODO tree
  replace(todos: TodoItem[]): void;

  // Get current TODO state (read-only)
  getState(): TodoItem[];
}
```

Example usage:

```javascript
// Complete a task
todo.complete('task-1', { output: 'Done!' });

// Expand a task into subtasks
todo.expand('task-2', [
  { id: 'task-2-1', content: 'Subtask A' },
  { id: 'task-2-2', content: 'Subtask B' },
]);

// Update multiple items
todo.update('task-3', { status: 'in_progress' });
todo.complete('task-4');
```

This approach minimizes LLM tool calls by allowing multiple TODO operations in a single call.

### Memory Control

| Tool              | Description                                          |
| ----------------- | ---------------------------------------------------- |
| `trigger_compact` | Manually trigger memory compaction                   |
| `mark_critical`   | Mark certain memory as critical (prevent compaction) |
| `forget`          | Explicitly forget/remove certain memory              |

### Context Control

| Tool             | Description                           |
| ---------------- | ------------------------------------- |
| `inject_context` | Inject additional context information |
| `switch_context` | Switch to a different context/mode    |

---

## Notes

- Control tools trigger internal state changes via Reducers
- Each control tool invocation generates corresponding Events
- Control tools may have side effects on Agent's memory state
