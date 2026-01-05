# Components Module

Higher-level abstractions that combine chunks and tools for agent configuration.

## Overview

Components are modular building blocks that define an agent's structure. Each component can include:

- **Instructions** - Prompt content rendered as a memory chunk
- **Tools** - Custom tools automatically categorized and registered

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Components System                         │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Blueprint.components: ComponentConfig[]                     │
│      │                                                       │
│      ├── SystemComponent                                    │
│      │   ├── type: 'system'                                 │
│      │   ├── instructions: string (required)                │
│      │   ├── tools?: CustomToolConfig[] → 'common' category │
│      │   └── customData?: Record<string, unknown>           │
│      │                                                       │
│      ├── AgentComponent                                     │
│      │   ├── type: 'agent'                                  │
│      │   ├── instructions?: string                          │
│      │   ├── tools?: CustomToolConfig[] → 'agent' category  │
│      │   └── customData?: Record<string, unknown>           │
│      │                                                       │
│      └── WorkflowComponent                                  │
│          ├── type: 'workflow'                               │
│          ├── instructions?: string                          │
│          ├── tools?: CustomToolConfig[] → 'workflow' category│
│          └── customData?: Record<string, unknown>           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Component Types

### SystemComponent

System-level instructions and common tools.

```typescript
interface SystemComponent {
  type: 'system';
  instructions: string; // Required
  tools?: CustomToolConfig[];
  customData?: Record<string, unknown>;
}
```

- Maps to `SYSTEM` chunk type
- Tools registered with `common` category
- Retention: `CRITICAL`
- Priority: `1000`

### AgentComponent

Agent-specific instructions and tools.

```typescript
interface AgentComponent {
  type: 'agent';
  instructions?: string;
  tools?: CustomToolConfig[];
  customData?: Record<string, unknown>;
}
```

- Maps to `AGENT` chunk type
- Tools registered with `agent` category
- Retention: `CRITICAL`
- Priority: `900`

### WorkflowComponent

Workflow-specific instructions and tools.

```typescript
interface WorkflowComponent {
  type: 'workflow';
  instructions?: string;
  tools?: CustomToolConfig[];
  customData?: Record<string, unknown>;
}
```

- Maps to `WORKFLOW` chunk type
- Tools registered with `workflow` category
- Retention: `COMPRESSIBLE`
- Priority: `800`

## ComponentRenderer

Converts components to chunks and tools at runtime.

### Usage

```typescript
import { createComponentRenderer, ComponentConfig } from '@team9/agent-framework';

const renderer = createComponentRenderer();

const components: ComponentConfig[] = [
  {
    type: 'system',
    instructions: 'You are a helpful assistant.',
    tools: [
      {
        definition: { name: 'search', description: 'Search the web', ... },
        executor: searchExecutor,
      },
    ],
  },
  {
    type: 'agent',
    instructions: 'Focus on code quality.',
    tools: [
      {
        definition: { name: 'lint', description: 'Lint code', ... },
        executor: lintExecutor,
      },
    ],
  },
];

const result = renderer.render(components);
// result.chunks: MemoryChunk[] (SYSTEM, AGENT chunks)
// result.tools: Tool[] (with proper categories assigned)
```

### ComponentRenderResult

```typescript
interface ComponentRenderResult {
  chunks: MemoryChunk[]; // Generated memory chunks
  tools: Tool[]; // Tools with categories assigned
}
```

## Blueprint Integration

Components are defined in Blueprint and processed by BlueprintLoader.

```typescript
const blueprint: Blueprint = {
  name: 'My Agent',
  llmConfig: { model: 'gpt-4' },
  components: [
    {
      type: 'system',
      instructions: 'You are a coding assistant.',
      tools: [readFileTool, writeFileTool],
    },
    {
      type: 'agent',
      tools: [codeReviewTool],
    },
  ],
  tools: ['wait_user_response', 'invoke_tool', 'task_complete'], // Control tools
};

// BlueprintLoader.createThreadFromBlueprint returns:
// - thread, initialState (as before)
// - tools: Tool[] (extracted from components)
```

## Mappings

### ComponentType to ToolCategory

| ComponentType | ToolCategory |
| ------------- | ------------ |
| `system`      | `common`     |
| `agent`       | `agent`      |
| `workflow`    | `workflow`   |

### ComponentType to ChunkType

| ComponentType | ChunkType  |
| ------------- | ---------- |
| `system`      | `SYSTEM`   |
| `agent`       | `AGENT`    |
| `workflow`    | `WORKFLOW` |

## Helper Functions

```typescript
// Create components easily
import {
  createSystemComponent,
  createAgentComponent,
  createWorkflowComponent,
} from '@team9/agent-framework';

const system = createSystemComponent('You are a helpful assistant.', [
  searchTool,
  fetchTool,
]);

const agent = createAgentComponent('Focus on TypeScript code.', [lintTool]);

const workflow = createWorkflowComponent('Follow the PR review workflow.', [
  submitPRTool,
]);
```

## Type Guards

```typescript
import {
  isSystemComponent,
  isAgentComponent,
  isWorkflowComponent,
} from '@team9/agent-framework';

if (isSystemComponent(component)) {
  // component.instructions is required
}
```

## Backward Compatibility

The `initialChunks` field in Blueprint is deprecated but still supported. When both `components` and `initialChunks` are present:

1. Components are rendered first
2. Legacy chunks are appended after component chunks
3. A warning is issued recommending migration to components

## Exports

```typescript
// Types
export type { ComponentType, ComponentConfig };
export type { SystemComponent, AgentComponent, WorkflowComponent };
export type { BaseComponent };
export type { ComponentRenderResult, ComponentRenderOptions };

// Constants
export { COMPONENT_TO_TOOL_CATEGORY, COMPONENT_TO_CHUNK_TYPE };

// Type Guards
export { isSystemComponent, isAgentComponent, isWorkflowComponent };

// Classes
export { ComponentRenderer };

// Factory Functions
export { createComponentRenderer };
export { createSystemComponent, createAgentComponent, createWorkflowComponent };
```
