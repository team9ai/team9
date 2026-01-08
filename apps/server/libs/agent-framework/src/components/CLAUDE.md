# Components Module

Component-Centric architecture for organizing agent functionality. Components are first-class citizens that encapsulate chunks, tools, events, and rendering logic.

## Overview

This module provides two component systems:

1. **New Component-Centric Architecture** (`IComponent` interface) - Full-featured components with lifecycle, event handling, and rendering
2. **Legacy ComponentConfig** - Simple declarative component definitions for backward compatibility

## Directory Structure

```
components/
├── base/                      # Core base components (always enabled)
│   ├── abstract-component.ts  # Base class for all components
│   ├── working-history/       # Conversation history management
│   ├── task-lifecycle/        # Task completion tracking
│   └── error/                 # Error handling and display
├── builtin/                   # Pre-built optional components
│   ├── system/                # System instructions
│   ├── todo/                  # Todo list management
│   ├── subagent/              # Sub-agent status tracking
│   └── memory/                # Memory management operations
├── component.interface.ts     # IComponent interface & types
├── component.types.ts         # Legacy ComponentConfig types
├── component-manager.ts       # Per-thread component lifecycle
├── component-renderer.ts      # Legacy blueprint rendering
└── template-renderer.ts       # Template expression rendering
```

---

## New Component-Centric Architecture

### Core Concepts

- **IComponent**: Main interface defining component behavior
- **AbstractComponent**: Base class providing default implementations
- **ComponentManager**: Manages component lifecycle and aggregation per thread

### Component Types (NewComponentType)

| Type        | Description                                                  |
| ----------- | ------------------------------------------------------------ |
| `base`      | Core framework component, always present, cannot be disabled |
| `stable`    | Once specified in blueprint, cannot be disabled at runtime   |
| `pluggable` | Can be enabled/disabled at runtime via events                |

### Component Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│                  Component Lifecycle                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  onInitialize()   ─→   First load into thread (one-time)    │
│       │                                                      │
│       ▼                                                      │
│  onActivate()     ─→   Component enabled                    │
│       │                                                      │
│       ▼                                                      │
│  [Component Active - handles events, renders chunks]         │
│       │                                                      │
│       ▼                                                      │
│  onDeactivate()   ─→   Component disabled (pluggable only)  │
│       │                                                      │
│       ▼                                                      │
│  onDestroy()      ─→   Complete removal (cleanup)           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Creating a Custom Component

```typescript
import {
  AbstractComponent,
  NewComponentType,
  ChunkType,
  ChunkRetentionStrategy,
} from '@team9/agent-framework';

class MyComponent extends AbstractComponent {
  readonly id = 'my-component';
  readonly name = 'My Component';
  readonly type: NewComponentType = 'pluggable';
  readonly dependencies = ['working-history']; // Optional

  constructor() {
    super();
    this.registerChunkConfig({
      key: 'main',
      type: ChunkType.AGENT,
      initialContent: { type: 'TEXT', text: 'Initial content' },
      retentionStrategy: ChunkRetentionStrategy.CRITICAL,
      mutable: true,
      priority: 500,
    });
  }

  getReducersForEvent(event: AgentEvent): ComponentReducerFn[] {
    if (event.type === EventType.USER_MESSAGE) {
      return [this.handleUserMessage.bind(this)];
    }
    return [];
  }

  private async handleUserMessage(
    state: MemoryState,
    event: AgentEvent,
    context: ComponentContext,
  ): Promise<ReducerResult> {
    // Process event and return operations
    return { operations: [], chunks: [] };
  }
}
```

### Render Locations & Order

| Location | Description                                             |
| -------- | ------------------------------------------------------- |
| `system` | Rendered in system prompt (stable context)              |
| `flow`   | Rendered in conversation flow (user/assistant messages) |

**Order Ranges:**

- 0-100: Static content (base instructions)
- 100-300: Semi-static content (loaded documents)
- 300-1000: Dynamic content (conversation, todos)

### Key Files

| File                                                     | Description                                          |
| -------------------------------------------------------- | ---------------------------------------------------- |
| [component.interface.ts](component.interface.ts)         | `IComponent`, `ComponentContext`, `RenderedFragment` |
| [component-manager.ts](component-manager.ts)             | `ComponentManager` class                             |
| [base/abstract-component.ts](base/abstract-component.ts) | `AbstractComponent` base class                       |

---

## Legacy ComponentConfig (Backward Compatible)

Simple declarative components for blueprint definitions.

### Component Types

| Type       | ChunkType | ToolCategory | Retention    | Priority |
| ---------- | --------- | ------------ | ------------ | -------- |
| `system`   | SYSTEM    | common       | CRITICAL     | 1000     |
| `agent`    | AGENT     | agent        | CRITICAL     | 900      |
| `workflow` | WORKFLOW  | workflow     | COMPRESSIBLE | 800      |

### Usage

```typescript
import {
  createComponentRenderer,
  ComponentConfig,
} from '@team9/agent-framework';

const components: ComponentConfig[] = [
  {
    type: 'system',
    instructions: 'You are a helpful assistant.',
    tools: [searchTool],
  },
  {
    type: 'agent',
    instructions: 'Focus on code quality.',
    tools: [lintTool],
  },
];

const renderer = createComponentRenderer();
const result = renderer.render(components);
// result.chunks: MemoryChunk[]
// result.tools: Tool[] (with categories assigned)
```

### Helper Functions

```typescript
import {
  createSystemComponent,
  createAgentComponent,
  createWorkflowComponent,
} from '@team9/agent-framework';

const system = createSystemComponent('Instructions here', [tool1, tool2]);
const agent = createAgentComponent('Agent instructions', [tool3]);
const workflow = createWorkflowComponent('Workflow instructions', [tool4]);
```

---

## Exports

```typescript
// New Component-Centric Architecture
export type {
  IComponent,
  ComponentContext,
  ComponentReducerFn,
  RenderedFragment,
};
export type { NewComponentType, NewComponentConfig, ComponentRuntimeState };
export { AbstractComponent } from './base/abstract-component';
export { ComponentManager, createComponentManager } from './component-manager';

// Legacy ComponentConfig
export type { ComponentType, ComponentConfig };
export {
  ComponentRenderer,
  createComponentRenderer,
} from './component-renderer';
export { createSystemComponent, createAgentComponent, createWorkflowComponent };

// Base Components
export * from './base';

// Builtin Components
export * from './builtin';
```
