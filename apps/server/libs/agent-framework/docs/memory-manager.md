# Memory Manager

Memory Manager is the core orchestrator of the Agent memory system, responsible for coordinating event processing, state management, and memory compaction.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MemoryManager                                   │
│  ┌─────────────┐  ┌──────────────────┐  ┌─────────────┐  ┌───────────────┐  │
│  │ EventQueue  │  │ ReducerRegistry  │  │ ThreadMgr   │  │  Compactors   │  │
│  │  (per-thread)│  │                  │  │             │  │               │  │
│  └─────────────┘  └──────────────────┘  └─────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                          ┌─────────────────┐
                          │ StorageProvider │
                          │  (InMemory/PG)  │
                          └─────────────────┘
```

## Event Processing Flow

### Normal Flow

```
Event → dispatch()
           │
           ▼
    ┌──────────────┐
    │ Queue blocked?│
    └──────┬───────┘
           │
     No    │    Yes
     ▼     │     ▼
processEvent()  enqueue() → wait for unblock
     │
     ▼
ReducerRegistry.reduce(state, event)
     │
     ▼
Operations + Chunks
     │
     ▼
ThreadManager.applyReducerResult()
     │
     ▼
Executor.applyOperations()
     │
     ▼
New State (persisted)
     │
     ▼
checkAutoCompaction()
     │
     ▼
[if threshold reached] → triggerCompaction() (background)
```

### Compaction Flow

```
triggerCompaction(threadId, chunks?)
           │
           ▼
    block(COMPACTING)  ← New events are queued for waiting
           │
           ▼
    Find suitable compactor
           │
           ▼
    Build CompactionContext
    (state, taskGoal, progressSummary)
           │
           ▼
    compactor.compact(chunks, context)
           │
           ▼
    LLM generates summary
           │
           ▼
    Create BATCH_REPLACE operation
    (replace original chunks with compacted chunk)
           │
           ▼
    ThreadManager.applyReducerResult()
           │
           ▼
    unblock()
           │
           ▼
    processQueue()  ← Process waiting events
```

## Blocking Mechanism

### BlockingReason

| Reason       | Description                      |
| ------------ | -------------------------------- |
| `COMPACTING` | Compaction operation in progress |
| `PAUSED`     | Manually paused (reserved)       |

### EventQueue Behavior

- **When not blocked**: Events are processed immediately
- **When blocked**: Events are queued, returns Promise, waits for unblock before processing
- **After unblock**: Automatically processes all events in queue

```typescript
// Check if blocked
manager.isBlocked(threadId);

// Get blocking reason
manager.getBlockingReason(threadId);
```

## Compaction

### Compaction Strategy

Determines which chunks can be compacted based on `ChunkRetentionStrategy`:

| Strategy             | Compactable | Description                               |
| -------------------- | ----------- | ----------------------------------------- |
| `CRITICAL`           | No          | Must be retained, not compacted           |
| `COMPRESSIBLE`       | Yes         | Can be compacted individually             |
| `BATCH_COMPRESSIBLE` | Yes         | Can be batch compacted                    |
| `DISPOSABLE`         | Yes         | Can be discarded, priority for compaction |
| `EPHEMERAL`          | N/A         | Discarded after session ends              |

### Auto-Compaction

Automatically triggered when the number of compactable WORKING_FLOW chunks reaches threshold:

```typescript
const manager = new MemoryManager(storage, registry, llmAdapter, {
  llm: { compactModel: 'gpt-4o-mini' },
  autoCompactEnabled: true, // default true
  autoCompactThreshold: 20, // default 20 chunks
});
```

### Manual Compaction

```typescript
// Compact all compactable chunks
await manager.triggerCompaction(threadId);

// Compact specific chunks
await manager.triggerCompaction(threadId, specificChunks);
```

### WorkingHistoryCompactor

Specifically designed for compacting conversation history chunks:

**Input Format (XML)**:

```xml
<context>
  <task_goal>User's task goal</task_goal>
  <progress_summary>Previous progress summary</progress_summary>
  <system_context>System context</system_context>
</context>

<working_history_to_compact>
  <entry index="1" type="THINKING" timestamp="...">
    Thinking content...
  </entry>
  <entry index="2" type="AGENT_ACTION" timestamp="...">
    Action content...
  </entry>
</working_history_to_compact>
```

**Output Format**:

```markdown
## Progress Summary

### Completed Actions

- List of completed operations

### Attempted Approaches

- Methods attempted (success/failure)

### Current State

Current state description

### Key Information

- Important information, file paths, decisions

### Next Steps

- Things to do next
```

## Usage Examples

### Initialization

```typescript
import {
  MemoryManager,
  DefaultReducerRegistry,
  InMemoryStorageProvider,
} from '@team9/agent-framework';

// Create LLM adapter (implementing ILLMAdapter interface)
const llmAdapter: ILLMAdapter = {
  async complete(request) {
    // Call ai-client or other LLM service
    const response = await aiClient.chat({
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });
    return {
      content: response.content,
      usage: response.usage,
    };
  },
};

// Create MemoryManager
const manager = new MemoryManager(
  new InMemoryStorageProvider(),
  new DefaultReducerRegistry(),
  llmAdapter,
  {
    llm: {
      compactModel: 'gpt-4o-mini',
      compactTemperature: 0.3,
      compactMaxTokens: 2000,
    },
    autoCompactEnabled: true,
    autoCompactThreshold: 20,
  },
);
```

### Event Processing

```typescript
// Create thread
const { thread, initialState } = await manager.createThread();

// Dispatch event
const result = await manager.dispatch(thread.id, {
  type: EventType.USER_MESSAGE,
  timestamp: Date.now(),
  content: 'Hello, agent!',
});

// Batch dispatch
await manager.dispatchAll(thread.id, [event1, event2, event3]);
```

### Custom Compactor

```typescript
import {
  ICompactor,
  CompactionResult,
  CompactionContext,
} from '@team9/agent-framework';

class CustomCompactor implements ICompactor {
  canCompact(chunks: MemoryChunk[]): boolean {
    // Determine if these chunks can be handled
    return chunks.every((c) => c.type === ChunkType.ENVIRONMENT);
  }

  async compact(
    chunks: MemoryChunk[],
    context: CompactionContext,
  ): Promise<CompactionResult> {
    // Custom compaction logic
    // ...
  }
}

manager.registerCompactor(new CustomCompactor());
```

## Configuration Reference

### MemoryManagerConfig

| Field                  | Type        | Default  | Description                                      |
| ---------------------- | ----------- | -------- | ------------------------------------------------ |
| `llm`                  | `LLMConfig` | required | LLM configuration                                |
| `autoCompactEnabled`   | `boolean`   | `true`   | Whether to enable auto-compaction                |
| `autoCompactThreshold` | `number`    | `20`     | Chunk count threshold to trigger auto-compaction |

### LLMConfig

| Field                | Type     | Default  | Description                 |
| -------------------- | -------- | -------- | --------------------------- |
| `compactModel`       | `string` | required | Model to use for compaction |
| `compactTemperature` | `number` | `0.3`    | Temperature parameter       |
| `compactMaxTokens`   | `number` | `2000`   | Maximum output token count  |
