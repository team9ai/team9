# Base Components

Core framework components that provide fundamental agent functionality. These are typically `base` type components that are always enabled and cannot be disabled.

## Overview

Base components handle essential agent operations:

- **Working History** - Conversation flow and message history
- **Task Lifecycle** - Task completion, abandonment, termination
- **Error Handling** - Tool errors, skill errors, system errors

## Directory Structure

```
base/
├── abstract-component.ts    # Base class for all components
├── working-history/         # Conversation history management
├── task-lifecycle/          # Task completion tracking
└── error/                   # Error handling and display
```

## AbstractComponent

Base class providing default implementations for `IComponent` interface.

### Features

- Default chunk management (`registerChunkConfig`, `createInitialChunks`)
- Default tool registration (`registerTool`)
- Default rendering (XML-tagged content in system prompt)
- Lifecycle hook stubs

### Usage

```typescript
import { AbstractComponent } from '@team9/agent-framework';

class MyComponent extends AbstractComponent {
  readonly id = 'my-component';
  readonly name = 'My Component';
  readonly type: NewComponentType = 'base';

  constructor() {
    super();
    // Register chunk configurations
    this.registerChunkConfig({
      key: 'main',
      type: ChunkType.SYSTEM,
      initialContent: { type: 'TEXT', text: 'Content' },
      retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      mutable: false,
      priority: 100,
    });

    // Register tools
    this.registerTool({
      definition: { name: 'my_tool', ... },
      executor: async (params) => { ... },
      category: 'common',
    });
  }
}
```

## Component Organization Pattern

Each base component follows this structure:

```
component-name/
├── index.ts                    # Public exports
├── component-name.component.ts # Component class
├── component-name.types.ts     # Type definitions
├── component-name.operations.ts # Chunk operations (create, update)
└── component-name.reducers.ts  # Event reducers
```

## Exports

```typescript
export { AbstractComponent } from './abstract-component';

// Working History
export { WorkingHistoryComponent, ... } from './working-history';

// Task Lifecycle
export { TaskLifecycleComponent, ... } from './task-lifecycle';

// Error Handling
export { ErrorComponent, ... } from './error';
```
