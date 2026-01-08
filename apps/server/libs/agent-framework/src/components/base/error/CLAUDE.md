# Error Component

Core base component for error handling. Handles tool errors, skill errors, subagent errors, and system errors.

## Overview

The Error component manages error display and tracking for various error sources in the agent system.

## Architecture

```
Error Handling Strategy:
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  Tool/Skill Errors                                          │
│      └── Added to WORKING_HISTORY as ACTION_RESPONSE chunks │
│                                                              │
│  SubAgent Errors                                             │
│      └── Added to WORKING_HISTORY as SUBAGENT_RESULT chunks │
│                                                              │
│  System Errors                                               │
│      └── Create standalone SYSTEM chunks (critical)         │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Component Details

| Property | Value                   |
| -------- | ----------------------- |
| ID       | `core:error`            |
| Name     | Error Handler           |
| Type     | `base` (always enabled) |

## Error Types

```typescript
type ErrorSeverity = 'warning' | 'error' | 'fatal';

interface ErrorEntry {
  code: string;
  message: string;
  severity: ErrorSeverity;
  source: string;
  timestamp: number;
  details?: unknown;
}
```

## Handled Events

| Event Type       | Description            | Output                |
| ---------------- | ---------------------- | --------------------- |
| `TOOL_ERROR`     | Tool execution failed  | ACTION_RESPONSE chunk |
| `SKILL_ERROR`    | Skill execution failed | ACTION_RESPONSE chunk |
| `SUBAGENT_ERROR` | Subagent failed        | SUBAGENT_RESULT chunk |
| `SYSTEM_ERROR`   | System-level error     | SYSTEM chunk          |

## Files

| File                  | Description                         |
| --------------------- | ----------------------------------- |
| `error.component.ts`  | `ErrorComponent` class              |
| `error.types.ts`      | `ErrorSeverity`, `ErrorEntry` types |
| `error.operations.ts` | Chunk creation operations           |
| `error.reducers.ts`   | Event reducer functions             |
| `index.ts`            | Public exports                      |

## Key Operations

### createSystemErrorChunk

Creates a SYSTEM chunk for critical system errors.

```typescript
import { createSystemErrorChunk } from '@team9/agent-framework';

const chunk = createSystemErrorChunk({
  componentId: 'core:error',
  code: 'CONFIG_ERROR',
  message: 'Invalid configuration',
  severity: 'fatal',
});
```

### createSystemErrorResult

Creates a complete reducer result for system errors.

```typescript
import { createSystemErrorResult } from '@team9/agent-framework';

const result = createSystemErrorResult({
  state,
  componentId: 'core:error',
  code: 'MEMORY_LIMIT',
  message: 'Memory limit exceeded',
  severity: 'error',
});
```

## Rendering

System error chunks are rendered with severity-based formatting:

```xml
<system-error severity="error" code="CONFIG_ERROR">
Error message here
</system-error>
```

## Exports

```typescript
export { ErrorComponent } from './error.component';
export type { ErrorSeverity, ErrorEntry } from './error.types';
export {
  createSystemErrorChunk,
  createSystemErrorResult,
  type SystemErrorChunkOptions,
} from './error.operations';
export {
  reduceToolError,
  reduceSkillError,
  reduceSubAgentError,
  reduceSystemError,
} from './error.reducers';
```
