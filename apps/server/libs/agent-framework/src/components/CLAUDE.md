# Components Module

Component-Centric architecture for organizing agent functionality. Components are first-class citizens that encapsulate chunks, tools, events, and rendering logic.

## Overview

This module provides the **Component-Centric Architecture** (`IComponent` interface) - full-featured components with lifecycle, event handling, and rendering.

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
├── component-manager.ts       # Global component registration
├── component-context.ts       # Runtime context implementation
├── component-registry.ts      # Component class registry
├── component-renderer.ts      # Fragment assembly and rendering
├── thread-component.provider.ts # Thread-level component provider
└── template-renderer.ts       # Template expression rendering
```

---

## Component-Centric Architecture

### Core Concepts

- **IComponent**: Main interface defining component behavior
- **AbstractComponent**: Base class providing default implementations
- **ComponentManager**: Global registry for component constructors
- **ComponentRegistry**: Per-thread component instance storage
- **ComponentRenderer**: Renders chunks to fragments and assembles prompts

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

  getReducersForEvent(event: BaseEvent): ComponentReducerFn[] {
    if (event.type === EventType.USER_MESSAGE) {
      return [this.handleUserMessage.bind(this)];
    }
    return [];
  }

  private async handleUserMessage(
    state: MemoryState,
    event: BaseEvent,
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
| [component-renderer.ts](component-renderer.ts)           | `ComponentRenderer` class                            |
| [base/abstract-component.ts](base/abstract-component.ts) | `AbstractComponent` base class                       |

---

## Rendering Architecture

The rendering system uses two main classes:

### ComponentRenderer

Responsible for:

- Collecting `RenderedFragment[]` from each component's `renderChunk()` method
- Separating fragments by location (system/flow)
- Sorting fragments by order
- Assembling into `systemContent` and `flowMessages`

```typescript
const renderer = new ComponentRenderer();
const result = renderer.render(state, {
  threadId: 'thread-1',
  components: activeComponents,
});

// result.systemContent: string (assembled system prompt)
// result.flowMessages: FlowMessage[] (user/assistant messages)
```

### ComponentContextBuilder

Wraps `ComponentRenderer` and adds:

- Token counting
- Token limit enforcement
- Message construction for LLM calls

```typescript
const builder = new ComponentContextBuilder(tokenizer);
const result = builder.build(state, {
  threadId: 'thread-1',
  components: activeComponents,
  maxTokens: 4000,
});

// result.messages: ContextMessage[]
// result.tokenCount: number
```

---

## Exports

```typescript
// Component-Centric Architecture
export type {
  IComponent,
  ComponentContext,
  ComponentReducerFn,
  RenderedFragment,
};
export type { NewComponentType, NewComponentConfig, ComponentRuntimeState };
export { AbstractComponent } from './base/abstract-component';
export { ComponentManager, createComponentManager } from './component-manager';
export {
  ComponentRenderer,
  createComponentRenderer,
} from './component-renderer';

// Base Components
export * from './base';

// Builtin Components
export * from './builtin';
```
