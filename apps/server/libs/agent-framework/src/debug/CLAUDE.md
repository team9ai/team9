# Debug Controller

This directory contains debugging and execution control capabilities for the agent framework.

## File Structure

| File                  | Description                               |
| --------------------- | ----------------------------------------- |
| `debug.types.ts`      | Interface definitions for DebugController |
| `debug-controller.ts` | Default implementation of DebugController |
| `index.ts`            | Public exports                            |

## DebugController Interface

The `DebugController` provides capabilities for:

1. **Execution Control** - Pause/resume, stepping mode
2. **State Inspection** - Fork, snapshot, restore
3. **State Modification** - Edit chunks, inject events

## Execution Mode Control

DebugController exposes execution mode control methods that delegate to MemoryManager:

| Method                   | Description                             |
| ------------------------ | --------------------------------------- |
| `getExecutionMode()`     | Get current mode ('auto' \| 'stepping') |
| `setExecutionMode()`     | Switch between auto and stepping mode   |
| `step()`                 | Execute single step (in stepping mode)  |
| `hasPendingCompaction()` | Check if compaction is queued           |
| `getQueuedEventCount()`  | Get number of queued events             |
| `peekNextEvent()`        | Preview next event without processing   |

### Usage

```typescript
import { createDebugController } from '@team9/agent-framework';

const controller = createDebugController(memoryManager, storage);

// Enter stepping mode
await controller.setExecutionMode(threadId, 'stepping');

// Dispatch events (they will be queued)
await manager.dispatch(threadId, event1);
await manager.dispatch(threadId, event2);

// Step through one at a time
while (
  controller.getQueuedEventCount(threadId) > 0 ||
  controller.hasPendingCompaction(threadId)
) {
  const result = await controller.step(threadId);

  if (result.compactionPerformed) {
    console.log('Compaction executed');
  } else if (result.dispatchResult) {
    console.log('Event processed:', result.dispatchResult);
  }

  console.log('Remaining:', result.remainingEvents);
}

// Resume auto mode
await controller.setExecutionMode(threadId, 'auto');
```

## Other Debug Capabilities

### Pause/Resume

```typescript
controller.pause(threadId); // Pause execution
controller.isPaused(threadId); // Check if paused
controller.resume(threadId); // Resume execution
```

### Event Injection

```typescript
await controller.injectEvent(threadId, customEvent);
```

### State Forking

```typescript
const fork = await controller.forkFromState(threadId, stateId);
// fork.newThreadId, fork.newThread, fork.forkedState
```

### Chunk Editing

```typescript
const edit = await controller.editChunk(threadId, stateId, chunkId, newContent);
// edit.thread, edit.newState, edit.editedChunk
```

### Snapshots

```typescript
// Create snapshot
const snapshot = await controller.createSnapshot(threadId, 'Before refactor');

// List snapshots
const snapshots = controller.getSnapshots(threadId);

// Restore from snapshot
await controller.restoreSnapshot(snapshot);

// Delete snapshot
controller.deleteSnapshot(snapshotId);
```

## StepResult Interface

```typescript
interface StepResult {
  /** The dispatch result, or null if no event was processed */
  dispatchResult: DispatchResult | null;
  /** Whether a compaction was performed */
  compactionPerformed: boolean;
  /** Number of remaining events in the queue */
  remainingEvents: number;
}
```

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Debug controller changes may affect:

- Execution mode control flow
- State inspection capabilities
- Integration with MemoryManager
