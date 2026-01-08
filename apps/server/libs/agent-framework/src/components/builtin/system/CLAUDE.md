# System Instructions Component

Builtin component for system-level instructions. Handles static system prompts and configurations with template support.

## Overview

The System Instructions component provides the main system prompt and context sections for an agent.

## Component Details

| Property | Value                         |
| -------- | ----------------------------- |
| ID       | `builtin:system`              |
| Name     | System Instructions           |
| Type     | `stable` (cannot be disabled) |

## Configuration

```typescript
interface SystemInstructionsComponentConfig {
  /** Main system instructions */
  instructions: string;
  /** Context sections (key-value pairs) */
  context?: Record<string, string>;
  /** Template variables for interpolation */
  variables?: Record<string, string>;
  /** Render order (default: 50, range 0-100) */
  order?: number;
}
```

## Usage

```typescript
import { SystemInstructionsComponent } from '@team9/agent-framework';

const component = new SystemInstructionsComponent({
  instructions: 'You are a helpful coding assistant.',
  context: {
    project: 'This is a TypeScript project using NestJS.',
    guidelines: 'Follow clean code principles.',
  },
  variables: {
    date: new Date().toISOString(),
    version: '1.0.0',
  },
  order: 10, // Render early in system prompt
});
```

## Template Support

Instructions and context can include template expressions:

```typescript
const component = new SystemInstructionsComponent({
  instructions: 'Current date: {{date}}. Version: {{version}}.',
  variables: {
    date: '2024-01-15',
    version: '2.0.0',
  },
});
// Renders: "Current date: 2024-01-15. Version: 2.0.0."
```

## Rendering

- Location: `system` prompt
- Order: 0-100 (static content range)
- Main instructions render first
- Context sections render after (+10 order)

## Files

| File                   | Description                         |
| ---------------------- | ----------------------------------- |
| `system.component.ts`  | `SystemInstructionsComponent` class |
| `system.types.ts`      | Configuration types                 |
| `system.operations.ts` | Chunk creation operations           |
| `index.ts`             | Public exports                      |

## Exports

```typescript
export { SystemInstructionsComponent } from './system.component';
export type { SystemInstructionsComponentConfig } from './system.types';
export {
  SYSTEM_CHUNK_KEY,
  createMainInstructionsChunk,
  createContextChunk,
} from './system.operations';
```
