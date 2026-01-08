# Builtin Components

Pre-built optional components for common agent functionality. These components can be selectively enabled based on agent needs.

## Overview

Builtin components provide reusable functionality that many agents need but isn't part of the core framework. They can be `stable` (always on once enabled) or `pluggable` (can be toggled at runtime).

## Directory Structure

```
builtin/
├── system/      # System instructions and main prompt
├── todo/        # Todo list management
├── subagent/    # Sub-agent status tracking
└── memory/      # Memory management operations
```

## Components Summary

| Component                   | ID                 | Type      | Description             |
| --------------------------- | ------------------ | --------- | ----------------------- |
| SystemInstructionsComponent | `builtin:system`   | stable    | Main agent instructions |
| TodoComponent               | `builtin:todo`     | pluggable | Task list management    |
| SubAgentComponent           | `builtin:subagent` | pluggable | Sub-agent tracking      |
| MemoryComponent             | `builtin:memory`   | pluggable | Memory operations       |

## Usage

### Blueprint Configuration

```typescript
const blueprint: Blueprint = {
  name: 'My Agent',
  llmConfig: { model: 'gpt-4' },
  newComponents: [
    {
      component: SystemInstructionsComponent,
      config: {
        mainInstructions: 'You are a helpful assistant.',
        contextTemplate: '{{date}} - {{workspace}}',
      },
    },
    { component: TodoComponent },
    { component: MemoryComponent },
  ],
};
```

### Manual Registration

```typescript
import {
  SystemInstructionsComponent,
  TodoComponent,
  ComponentManager,
} from '@team9/agent-framework';

const manager = new ComponentManager();
manager.registerComponent(
  new SystemInstructionsComponent({
    mainInstructions: 'You are a helpful assistant.',
  }),
);
manager.registerComponent(new TodoComponent());
```

## Exports

```typescript
// System Instructions
export {
  SystemInstructionsComponent,
  type SystemInstructionsComponentConfig,
  SYSTEM_CHUNK_KEY,
  createMainInstructionsChunk,
  createContextChunk,
} from './system';

// Todo Management
export {
  TodoComponent,
  type TodoItem,
  TODO_CHUNK_KEY,
  findTodoChunk,
  createTodoChunk,
  ...
} from './todo';

// SubAgent Tracking
export {
  SubAgentComponent,
  type SubAgentInfo,
  SUBAGENT_STATUS_CHUNK_KEY,
  createSubAgentStatusChunk,
} from './subagent';

// Memory Operations
export {
  MemoryComponent,
  type MemoryStats,
  reduceMarkCritical,
  reduceForget,
} from './memory';
```
