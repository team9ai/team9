# Memory Manager

This directory contains the core orchestrators for the Memory system.

## File Structure

| File                           | Description                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------- |
| `memory.manager.ts`            | MemoryManager: main orchestrator integrating all components                      |
| `thread.manager.ts`            | ThreadManager: manages thread lifecycle, state persistence, and persistent queue |
| `event-processor.ts`           | EventProcessor: core event processing logic (reducer, state update)              |
| `compaction.manager.ts`        | CompactionManager: handles memory compaction logic                               |
| `execution-mode.controller.ts` | ExecutionModeController: manages auto/stepping execution modes                   |

## Architecture

```
                    ┌───────────────────────────────────────────────┐
                    │              MemoryManager                    │
                    │  ┌───────────────┐  ┌───────────────────────┐ │
                    │  │    Thread     │  │  ExecutionMode        │ │
  Event ──────────► │  │    Manager    │  │  Controller           │ │
                    │  └───────────────┘  └───────────────────────┘ │
                    │  ┌───────────────┐  ┌───────────────────────┐ │
                    │  │    Event      │  │   Persistent Queue    │ │
                    │  │   Processor   │  │   (in Thread)         │ │
                    │  └───────────────┘  └───────────────────────┘ │
                    │  ┌───────────────┐  ┌───────────────────────┐ │
                    │  │  Compaction   │  │    Observer           │ │
                    │  │    Manager    │  │    Manager            │ │
                    │  └───────────────┘  └───────────────────────┘ │
                    └───────────────────────────────────────────────┘
                                         │
                                         ▼
                                  New MemoryState
```

## Key Design Principle: Serial Processing

**All event processing is serial (one at a time).** This eliminates the need for complex blocking mechanisms:

1. Events are always pushed to the persistent queue first
2. Events are processed one at a time from the queue
3. Step locking (`currentStepId` in Thread) prevents concurrent step execution
4. No in-memory blocking queues needed

## MemoryManager

Main entry point for the Memory system.

```typescript
import { MemoryManager } from './manager';

const manager = new MemoryManager(storage, reducerRegistry, llmAdapter, {
  llm: llmConfig,
  autoCompactEnabled: true,
  tokenThresholds: {
    softThreshold: 50000,
    hardThreshold: 80000,
    truncationThreshold: 100000,
  },
  defaultExecutionMode: 'auto', // or 'stepping'
});

// Dispatch event (queued first, then processed based on mode)
const newState = await manager.dispatch(threadId, event);

// Trigger compaction manually
await manager.triggerCompaction(threadId, chunks);

// Execute truncation (removes oldest WORKING_FLOW chunks)
await manager.executeTruncation(threadId, chunkIds);
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
// result: { dispatchResult, eventProcessed, compactionPerformed, truncationPerformed, hasPendingOperations, queuedEventCount }

// Check queue status
const hasPendingCompact = manager.hasPendingCompaction(threadId);
const hasPendingTrunc = manager.hasPendingTruncation(threadId);

// Switch back to auto
await manager.setExecutionMode(threadId, 'auto');
```

### Stepping Mode Behavior

1. Events dispatched via `dispatch()` are **pushed to persistent queue** (stored in Thread)
2. `step()` acquires a step lock, then processes with the following priority:
   - **First**: Pop and process one event from persistent queue
   - **Second**: Execute pending truncation (if no events in queue)
   - **Third**: Execute pending compaction (if no events and no truncation)
3. Returns `StepResult`:
   ```typescript
   {
     dispatchResult: DispatchResult | null,
     eventProcessed: boolean,      // Whether an event was processed
     compactionPerformed: boolean,
     truncationPerformed: boolean,
     hasPendingOperations: boolean,
     queuedEventCount: number,     // Remaining events in persistent queue
   }
   ```

### Step Locking

The `step()` method uses a step lock to ensure only one step can be processed at a time:

```typescript
// Check if a step is currently running
const isLocked = await manager.isStepLocked(threadId);

// Get the current step ID if locked
const stepId = await manager.getCurrentStepId(threadId);
```

The lock is stored as `currentStepId` in the Thread and is automatically released after each step completes.

## Persistent Event Queue

Events are stored in `Thread.eventQueue` and persist to database:

```typescript
// Push event to persistent queue
await manager.pushEventToQueue(threadId, event);

// Pop event from queue
const queuedEvent = await manager.popEventFromQueue(threadId);

// Get queue contents
const queue = await manager.getPersistentEventQueue(threadId);

// Get queue length
const length = await manager.getPersistentQueueLength(threadId);
```

This enables:

- **Recovery after restart**: Unprocessed events are preserved
- **Debugger visibility**: Queue can be observed via API
- **Step-by-step execution**: Events processed one at a time in stepping mode

### QueuedEvent Type

```typescript
interface QueuedEvent {
  id: string; // Generated ID with 'qevt_' prefix
  event: AgentEvent; // The actual event
  queuedAt: number; // Timestamp when queued
}
```

## ThreadManager

Manages thread lifecycle, state persistence, persistent event queue, and step locking.

```typescript
const threadManager = new ThreadManager(storageProvider);

// Get or create thread
const thread = await threadManager.getOrCreateThread(agentId, threadId);

// Get current state (uses in-memory cache first)
const state = await threadManager.getCurrentState(threadId);

// Save state
await threadManager.saveState(threadId, newState);

// Clear state cache (forces re-read from storage)
threadManager.clearStateCache(threadId);
```

### Persistent Event Queue Operations

Events are stored in `Thread.eventQueue` and persisted to database:

```typescript
// Push event to queue (returns QueuedEvent with generated ID)
const queuedEvent = await threadManager.pushEvent(threadId, event);
// queuedEvent: { id: 'qevt_xxx', event: AgentEvent, queuedAt: number }

// Pop first event from queue
const poppedEvent = await threadManager.popEvent(threadId);

// Peek at first event without removing
const nextEvent = await threadManager.peekEvent(threadId);

// Get full queue
const queue = await threadManager.getEventQueue(threadId);

// Get queue length
const length = await threadManager.getEventQueueLength(threadId);

// Clear all events
await threadManager.clearEventQueue(threadId);
```

### Step Lock Operations

Step locking ensures only one step can be processed at a time:

```typescript
// Acquire step lock (throws if already locked)
const stepId = await threadManager.acquireStepLock(threadId);

// Release step lock (stepId must match)
await threadManager.releaseStepLock(threadId, stepId);

// Check if thread is locked
const isLocked = await threadManager.isStepLocked(threadId);

// Get current step ID
const currentStepId = await threadManager.getCurrentStepId(threadId);
```

## EventProcessor

Extracted core event processing logic from MemoryManager. Handles the unified processing flow for both auto and stepping modes.

```typescript
const eventProcessor = new EventProcessor(
  threadManager,
  reducerRegistry,
  observerManager,
  compactionManager,
  executionModeController,
);

// Process an event
const result = await eventProcessor.processEvent(threadId, event, {
  steppingMode: false, // or true for stepping mode
});
// result: { thread, state, addedChunks, removedChunkIds }

// Check for pending compaction (set during processing)
const chunks = eventProcessor.consumePendingCompaction(threadId);
```

### Processing Flow

1. Notify observers of event dispatch
2. Get current state from ThreadManager
3. Run event through ReducerRegistry
4. Notify observers of reducer execution
5. If no operations, return unchanged state
6. Apply operations through ThreadManager
7. Notify observers of state change
8. Check auto-compaction threshold
9. Queue compaction as pending (for both modes)

### Options

| Option         | Type    | Default | Description                                                           |
| -------------- | ------- | ------- | --------------------------------------------------------------------- |
| `steppingMode` | boolean | false   | Whether processing in stepping mode (queues compaction for next step) |

### Responsibilities

- Unified event processing for auto and stepping modes
- Reducer execution and observer notifications
- Auto-compaction threshold checking
- Pending compaction management (via ExecutionModeController)

## CompactionManager

Extracted compaction logic from MemoryManager for better separation of concerns. Uses token-based thresholds for intelligent memory management.

```typescript
const compactionManager = new CompactionManager(llmAdapter, {
  llm: llmConfig,
  autoCompactEnabled: true,
  tokenThresholds: {
    softThreshold: 50000, // Suggest compaction (default: 50K tokens)
    hardThreshold: 80000, // Force compaction (default: 80K tokens)
    truncationThreshold: 100000, // Truncate oldest chunks (default: 100K tokens)
  },
});

// Get compressible chunks from state
const chunks = compactionManager.getCompressibleChunks(state);

// Check token usage and get compaction/truncation recommendations
const result = compactionManager.checkTokenUsage(state);
// result: {
//   totalTokens: number,
//   compressibleTokens: number,
//   suggestCompaction: boolean,  // soft threshold reached
//   forceCompaction: boolean,    // hard threshold reached
//   needsTruncation: boolean,    // truncation threshold reached
//   chunksToCompact: MemoryChunk[],
//   chunksToTruncate: string[],  // oldest WORKING_FLOW chunk IDs
// }

// Execute compaction
const result = await compactionManager.executeCompaction(
  threadId,
  chunks,
  threadManager,
  observerManager,
);

// Register custom compactor
compactionManager.registerCompactor(customCompactor);

// Get token thresholds
const thresholds = compactionManager.getTokenThresholds();
```

### Token-Based Thresholds

| Threshold  | Default | Description                                                      |
| ---------- | ------- | ---------------------------------------------------------------- |
| Soft       | 50,000  | Returns `suggestCompaction: true` - AI can compact at task break |
| Hard       | 80,000  | Returns `forceCompaction: true` - triggers immediate compaction  |
| Truncation | 100,000 | Returns `needsTruncation: true` - truncates oldest chunks        |

### Truncation Strategy

When truncation threshold is exceeded:

1. Calculate excess tokens (`totalTokens - hardThreshold`)
2. Select oldest WORKING_FLOW chunks by `createdAt` timestamp
3. Return chunk IDs to truncate until excess is covered

### Responsibilities

- Manages compactor registry (default: WorkingFlowCompactor)
- Token counting using model-appropriate tokenizer (tiktoken)
- Determines which chunks are compressible
- Token-based threshold checking (soft/hard/truncation)
- Executes compaction and notifies observers
- Extracts task goal and progress summary for compaction context

## ExecutionModeController

Manages execution mode and stepping logic. Simplified design since processing is serial.

```typescript
const controller = new ExecutionModeController({
  defaultExecutionMode: 'auto',
});

// Get/set execution mode
const mode = controller.getExecutionMode(threadId);
controller.setExecutionMode(threadId, 'stepping');

// Initialize for new thread
controller.initializeExecutionMode(threadId, 'stepping');

// Execute maintenance step (compaction/truncation only, events handled by MemoryManager)
const result = await controller.executeMaintenanceStep(
  threadId,
  executeCompaction,
  executeTruncation,
  queuedEventCount,
);
// result: { dispatchResult, eventProcessed, compactionPerformed, truncationPerformed, hasPendingOperations, queuedEventCount }

// Check/set pending compaction
controller.hasPendingCompaction(threadId);
controller.setPendingCompaction(threadId, chunks);

// Check/set pending truncation
controller.hasPendingTruncation(threadId);
controller.setPendingTruncation(threadId, chunkIds);

// Cleanup when thread is deleted
controller.cleanup(threadId);
```

### Callback Types

```typescript
// Compaction executor callback
type CompactionExecutor = (
  threadId: string,
  chunks: MemoryChunk[],
) => Promise<DispatchResult>;

// Truncation executor callback
type TruncationExecutor = (
  threadId: string,
  chunkIds: string[],
) => Promise<DispatchResult>;
```

### Responsibilities

- Manages per-thread execution mode state
- Tracks pending compaction for stepping mode
- Tracks pending truncation for stepping mode
- Executes maintenance operations during step()

## Memory Management Flow

### Token-Based Threshold Checks

After each event dispatch, the system checks token usage:

1. **Soft threshold** (50K): Sets `suggestCompaction: true` - AI can choose to compact at task break
2. **Hard threshold** (80K): Sets `forceCompaction: true` - triggers immediate compaction
3. **Truncation threshold** (100K): Sets `needsTruncation: true` - triggers oldest chunk removal

### Auto Mode Compaction Flow

1. Token usage check after each dispatch
2. If hard threshold reached:
   - Run compactor (LLM summarization)
   - Apply BATCH_REPLACE operation
3. Truncation and compaction happen synchronously in sequence

### Stepping Mode Flow

1. Events dispatched → added to persistent queue
2. `step()` acquires step lock
3. Pop one event from queue and process
4. Or execute pending truncation/compaction
5. Release step lock
6. Return result with queue status

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Manager changes may affect:

- Integration with storage providers
- Compaction flow
- Event processing order
- Execution mode control
- Step locking behavior
