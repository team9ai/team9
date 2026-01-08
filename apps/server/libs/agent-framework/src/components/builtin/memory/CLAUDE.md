# Memory Component

Stable component for memory retention management. Handles marking chunks as critical and forgetting chunks.

## Overview

The Memory component manages memory retention policies, allowing the agent to mark important information as critical (never compacted) or forget irrelevant information.

## Component Details

| Property | Value                         |
| -------- | ----------------------------- |
| ID       | `builtin:memory`              |
| Name     | Memory Manager                |
| Type     | `stable` (cannot be disabled) |

## Architecture

- Does NOT create its own chunks
- Operates on other components' chunks
- Modifies `retentionStrategy` of existing chunks
- Tracks critical and forgotten chunk IDs in component data

## Memory Stats

```typescript
interface MemoryStats {
  totalChunks: number;
  criticalChunks: number;
  compressibleChunks: number;
  forgottenChunks: number;
}
```

## Handled Events

| Event Type             | Description            | Effect                             |
| ---------------------- | ---------------------- | ---------------------------------- |
| `MEMORY_MARK_CRITICAL` | Mark chunk as critical | Sets `retentionStrategy: CRITICAL` |
| `MEMORY_FORGET`        | Forget a chunk         | Deletes the chunk                  |

## Usage

### Marking Critical Memory

```typescript
await manager.processEvent({
  type: EventType.MEMORY_MARK_CRITICAL,
  chunkId: 'chunk_abc123',
  reason: 'Contains important API key information',
});
```

### Forgetting Memory

```typescript
await manager.processEvent({
  type: EventType.MEMORY_FORGET,
  chunkId: 'chunk_xyz789',
  reason: 'No longer relevant to current task',
});
```

## Component Data

The component tracks memory operations:

```typescript
// Critical chunks
context.getData<Set<string>>('criticalChunkIds');

// Forgotten chunks (for audit)
context.getData<Set<string>>('forgottenChunkIds');
```

## Retention Strategies

| Strategy       | Description                         |
| -------------- | ----------------------------------- |
| `CRITICAL`     | Never compacted, always retained    |
| `COMPRESSIBLE` | Can be summarized during compaction |
| `EPHEMERAL`    | Can be dropped during compaction    |

## Files

| File                  | Description             |
| --------------------- | ----------------------- |
| `memory.component.ts` | `MemoryComponent` class |
| `memory.types.ts`     | `MemoryStats` type      |
| `memory.reducers.ts`  | Event reducer functions |
| `index.ts`            | Public exports          |

## Exports

```typescript
export { MemoryComponent } from './memory.component';
export type { MemoryStats } from './memory.types';
export { reduceMarkCritical, reduceForget } from './memory.reducers';
```
