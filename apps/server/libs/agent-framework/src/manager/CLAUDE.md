# Memory Manager

This directory contains the core orchestrators for the Memory system.

## File Structure

| File                           | Description                                                                |
| ------------------------------ | -------------------------------------------------------------------------- |
| `memory.manager.ts`            | MemoryManager: main orchestrator integrating all components                |
| `thread.manager.ts`            | ThreadManager: manages thread lifecycle and state persistence              |
| `event-processor.ts`           | EventProcessor: core event processing logic (reducer, state update)        |
| `compaction.manager.ts`        | CompactionManager: handles memory compaction logic                         |
| `execution-mode.controller.ts` | ExecutionModeController: manages auto/stepping execution modes             |
| `event-queue.ts`               | EventQueue: blocking queue for event processing during compaction/stepping |

## Architecture

```
                    ┌───────────────────────────────────────────────┐
                    │              MemoryManager                    │
                    │  ┌───────────────┐  ┌───────────────────────┐ │
                    │  │    Thread     │  │  ExecutionMode        │ │
  Event ──────────► │  │    Manager    │  │  Controller           │ │
                    │  └───────────────┘  └───────────────────────┘ │
                    │  ┌───────────────┐  ┌───────────────────────┐ │
                    │  │    Event      │  │     EventQueue        │ │
                    │  │   Processor   │  │                       │ │
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

// Dispatch event
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

// Single step execution (in stepping mode) - executes pending compaction/truncation
const result = await manager.step(threadId);
// result: { dispatchResult, compactionPerformed, truncationPerformed, hasPendingOperations }

// Check queue status
const hasPendingCompact = manager.hasPendingCompaction(threadId);
const hasPendingTrunc = manager.hasPendingTruncation(threadId);

// Switch back to auto
await manager.setExecutionMode(threadId, 'auto');
```

### Stepping Mode Behavior

1. Events dispatched via `dispatch()` are **processed immediately** (creates new state)
2. Compaction/truncation are **queued** (not executed immediately) after event processing
3. `step()` executes pending operations one at a time:
   - **Priority**: Truncation is executed first (if pending)
   - Then compaction is executed (if pending)
4. Returns `StepResult`:
   ```typescript
   {
     dispatchResult: DispatchResult | null,
     compactionPerformed: boolean,
     truncationPerformed: boolean,
     hasPendingOperations: boolean,
   }
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

Extracted execution mode and stepping logic from MemoryManager.

```typescript
const controller = new ExecutionModeController({
  defaultExecutionMode: 'auto',
});

// Get/set execution mode
const mode = controller.getExecutionMode(threadId);
await controller.setExecutionMode(threadId, 'stepping', queue, processEvent);

// Initialize for new thread
controller.initializeExecutionMode(threadId, 'stepping', queue);

// Step execution (processes one event or pending compaction)
const result = await controller.step(
  threadId,
  queue,
  processEvent,
  executeCompaction,
);
// result: { dispatchResult, compactionPerformed, remainingEvents }

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
// Event processor callback
type EventProcessor = (
  threadId: string,
  event: AgentEvent,
) => Promise<DispatchResult>;

// Compaction executor callback
type CompactionExecutor = (
  threadId: string,
  chunks: MemoryChunk[],
) => Promise<DispatchResult>;
```

### Responsibilities

- Manages per-thread execution mode state
- Controls stepping mode queue blocking
- Tracks pending compaction for stepping mode
- Tracks pending truncation for stepping mode
- Processes queued events when switching to auto mode

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

## Memory Management Flow

### Token-Based Threshold Checks

After each event dispatch, the system checks token usage:

1. **Soft threshold** (50K): Sets `suggestCompaction: true` - AI can choose to compact at task break
2. **Hard threshold** (80K): Sets `forceCompaction: true` - triggers immediate compaction
3. **Truncation threshold** (100K): Sets `needsTruncation: true` - triggers oldest chunk removal

### Compaction Flow

1. Token usage check after each dispatch
2. If hard threshold reached:
   - Block event queue
   - Run compactor (LLM summarization)
   - Apply BATCH_REPLACE operation
   - Unblock queue and process pending events

### Truncation Flow

1. If truncation threshold reached:
   - Calculate excess tokens
   - Select oldest WORKING_FLOW chunks by creation time
   - Delete chunks until under hard threshold

**In stepping mode**: Both compaction and truncation are queued and executed on next `step()` call.

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Manager changes may affect:

- Integration with storage providers
- Compaction flow
- Event processing order
- Execution mode control
