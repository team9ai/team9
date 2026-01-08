# Task Lifecycle Component

Core base component for task lifecycle management. Handles task completion, abandonment, and termination events.

## Overview

The Task Lifecycle component tracks the overall status of an agent's task and creates OUTPUT chunks for lifecycle events.

## Architecture

- Creates OUTPUT chunks for task lifecycle events
- Chunks are marked as CRITICAL and persist in memory
- Provides task status tracking via component data

## Component Details

| Property | Value                   |
| -------- | ----------------------- |
| ID       | `core:task-lifecycle`   |
| Name     | Task Lifecycle          |
| Type     | `base` (always enabled) |

## Task Status

```typescript
type TaskStatus = 'running' | 'completed' | 'abandoned' | 'terminated';

interface TaskLifecycleData {
  status: TaskStatus;
  startedAt: number;
  endedAt?: number;
  result?: string;
  reason?: string;
}
```

## Handled Events

| Event Type        | Description                                      |
| ----------------- | ------------------------------------------------ |
| `TASK_COMPLETED`  | Task successfully completed with result          |
| `TASK_ABANDONED`  | Task abandoned (user requested or agent decided) |
| `TASK_TERMINATED` | Task terminated (system/error)                   |

## Files

| File                           | Description                             |
| ------------------------------ | --------------------------------------- |
| `task-lifecycle.component.ts`  | `TaskLifecycleComponent` class          |
| `task-lifecycle.types.ts`      | `TaskStatus`, `TaskLifecycleData` types |
| `task-lifecycle.operations.ts` | Chunk creation operations               |
| `task-lifecycle.reducers.ts`   | Event reducer functions                 |
| `index.ts`                     | Public exports                          |

## Key Operations

### createTaskOutputChunk

Creates an OUTPUT chunk for task completion.

```typescript
import { createTaskOutputChunk } from '@team9/agent-framework';

const chunk = createTaskOutputChunk({
  componentId: 'core:task-lifecycle',
  status: 'completed',
  result: 'Task completed successfully',
});
```

### createTaskOutputResult

Creates a complete reducer result for task lifecycle events.

```typescript
import { createTaskOutputResult } from '@team9/agent-framework';

const result = createTaskOutputResult({
  state,
  componentId: 'core:task-lifecycle',
  status: 'completed',
  result: 'Analysis complete',
});
```

## Lifecycle Hooks

### onInitialize

Sets initial task status to `running` with start timestamp.

```typescript
onInitialize(context: ComponentContext): void {
  context.setData('lifecycle', {
    status: 'running',
    startedAt: Date.now(),
  });
}
```

## Exports

```typescript
export { TaskLifecycleComponent } from './task-lifecycle.component';
export type { TaskStatus, TaskLifecycleData } from './task-lifecycle.types';
export {
  createTaskOutputChunk,
  createTaskOutputResult,
  type TaskOutputOptions,
} from './task-lifecycle.operations';
export {
  reduceTaskCompleted,
  reduceTaskAbandoned,
  reduceTaskTerminated,
} from './task-lifecycle.reducers';
```
