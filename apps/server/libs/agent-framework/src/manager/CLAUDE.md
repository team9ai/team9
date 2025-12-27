# Memory Manager

This directory contains the core orchestrators for the Memory system.

## File Structure

| File                | Description                                                                |
| ------------------- | -------------------------------------------------------------------------- |
| `thread.manager.ts` | ThreadManager: manages thread lifecycle and state persistence              |
| `memory.manager.ts` | MemoryManager: main orchestrator integrating all components                |
| `event-queue.ts`    | EventQueue: blocking queue for event processing during compaction/stepping |

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │          MemoryManager              │
                    │  ┌───────────┐  ┌───────────────┐   │
                    │  │ Reducer   │  │    Thread     │   │
  Event ──────────► │  │ Registry  │  │    Manager    │   │
                    │  └───────────┘  └───────────────┘   │
                    │  ┌───────────┐  ┌───────────────┐   │
                    │  │ Compactors│  │  EventQueue   │   │
                    │  └───────────┘  └───────────────┘   │
                    └─────────────────────────────────────┘
                                     │
                                     ▼
                              New MemoryState
```

## MemoryManager

Main entry point for the Memory system.

```typescript
import { MemoryManager, createMemoryManager } from './manager';

const manager = createMemoryManager({
  storage: storageProvider,
  reducerRegistry: registry,
  compactors: [workingFlowCompactor],
  autoCompactThreshold: 50,
  defaultExecutionMode: 'auto', // or 'stepping'
});

// Dispatch event
const newState = await manager.dispatch(threadId, event);

// Trigger compaction manually
await manager.triggerCompaction(threadId, ChunkType.WORKING_FLOW);
```

## Execution Mode Control

MemoryManager supports two execution modes for debugging and batch generation safety:

| Mode       | Description                            | Use Case                    |
| ---------- | -------------------------------------- | --------------------------- |
| `auto`     | Events processed immediately (default) | Normal operation            |
| `stepping` | Events queued until `step()` called    | Debugging, batch generation |

### Usage

```typescript
// Set execution mode
await manager.setExecutionMode(threadId, 'stepping');

// Check mode
const mode = manager.getExecutionMode(threadId); // 'auto' | 'stepping'

// Single step execution (in stepping mode)
const result = await manager.step(threadId);
// result: { dispatchResult, compactionPerformed, remainingEvents }

// Check queue status
const count = manager.getQueuedEventCount(threadId);
const nextEvent = manager.peekNextEvent(threadId);
const hasPendingCompact = manager.hasPendingCompaction(threadId);

// Switch back to auto (processes all queued events)
await manager.setExecutionMode(threadId, 'auto');
```

### Stepping Mode Behavior

1. Events dispatched via `dispatch()` are queued instead of processed
2. `step()` processes one item at a time:
   - **Priority**: Pending compaction is executed first
   - Then next queued event is processed
3. Compaction is queued (not executed immediately) after event processing
4. Switching to `auto` mode processes all queued events

## ThreadManager

Manages thread lifecycle.

```typescript
const threadManager = new ThreadManager(storageProvider);

// Get or create thread
const thread = await threadManager.getOrCreateThread(agentId, threadId);

// Get current state
const state = await threadManager.getCurrentState(threadId);

// Save state
await threadManager.saveState(threadId, newState);
```

## EventQueue

Blocking queue for pausing event processing.

```typescript
const queue = new EventQueue<AgentEvent>();

// Block queue (various reasons)
queue.block(BlockingReason.COMPACTING); // During compaction
queue.block(BlockingReason.PAUSED); // Manual pause
queue.block(BlockingReason.STEPPING); // Stepping mode

// Events are queued while blocked
queue.enqueue(event);

// Process single event (for stepping)
const result = await queue.processOne(handler);

// Peek without processing
const nextEvent = queue.peek();

// Unblock and process all
queue.unblock();
await queue.processQueue(handler);
```

### BlockingReason Enum

| Reason       | Description              |
| ------------ | ------------------------ |
| `COMPACTING` | Compaction in progress   |
| `PAUSED`     | Manual pause (debugging) |
| `STEPPING`   | Stepping mode active     |

## Compaction Flow

1. Auto-compaction check after each dispatch (if threshold reached)
2. Block event queue
3. Run compactor (LLM summarization)
4. Apply COMPACT operation
5. Unblock queue and process pending events

**In stepping mode**: Compaction is queued and executed on next `step()` call.

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Manager changes may affect:

- Integration with storage providers
- Compaction flow
- Event processing order
- Execution mode control
