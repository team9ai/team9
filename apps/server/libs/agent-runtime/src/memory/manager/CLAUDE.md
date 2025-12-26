# Memory Manager

This directory contains the core orchestrators for the Memory system.

## File Structure

| File                | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `thread.manager.ts` | ThreadManager: manages thread lifecycle and state persistence     |
| `memory.manager.ts` | MemoryManager: main orchestrator integrating all components       |
| `event-queue.ts`    | EventQueue: blocking queue for event processing during compaction |

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
});

// Dispatch event
const newState = await manager.dispatch(threadId, event);

// Trigger compaction manually
await manager.triggerCompaction(threadId, ChunkType.WORKING_FLOW);
```

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

Blocking queue for pausing event processing during compaction.

```typescript
const queue = new EventQueue<AgentEvent>();

// Block queue during compaction
queue.block(BlockingReason.COMPACTING);

// Events are queued while blocked
queue.enqueue(event);

// Unblock and process queue
queue.unblock(BlockingReason.COMPACTING);
await queue.processQueue(handler);
```

## Compaction Flow

1. Auto-compaction check after each dispatch (if threshold reached)
2. Block event queue
3. Run compactor (LLM summarization)
4. Apply COMPACT operation
5. Unblock queue and process pending events

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Manager changes may affect:

- Integration with storage providers
- Compaction flow
- Event processing order
