# Memory System

This directory contains the Agent Memory Context system - a comprehensive memory management solution for AI agents.

## Directory Structure

```
memory/
├── types/           # Core type definitions
├── utils/           # Utility functions (ID generation)
├── factories/       # Factory functions for creating objects
├── executor/        # Operation executor (apply operations to state)
├── reducer/         # Event reducers (transform events to operations)
│   └── reducers/    # Concrete reducer implementations
├── storage/         # Storage providers
│   └── postgres/    # PostgreSQL implementation
├── manager/         # Core orchestrators (MemoryManager, ThreadManager)
├── llm/             # LLM adapter interface
├── compactor/       # Memory compaction (LLM summarization)
├── context/         # Context builder (state → LLM messages)
└── tokenizer/       # Token counting (js-tiktoken)
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      MemoryManager                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Reducer   │  │   Thread    │  │       Compactors        │  │
│  │  Registry   │  │   Manager   │  │  (LLM Summarization)    │  │
│  └──────┬──────┘  └──────┬──────┘  └───────────┬─────────────┘  │
└─────────┼────────────────┼─────────────────────┼────────────────┘
          │                │                     │
          ▼                ▼                     ▼
     ┌─────────┐      ┌─────────┐          ┌─────────┐
     │ Reducer │      │ Storage │          │   LLM   │
     │  Chain  │      │Provider │          │ Adapter │
     └────┬────┘      └────┬────┘          └─────────┘
          │                │
          ▼                ▼
     ┌─────────┐      ┌─────────┐
     │Executor │      │ Postgres│
     │ (Apply) │      │  / Mem  │
     └─────────┘      └─────────┘
```

## Data Flow

```
Event (USER_INPUT, TOOL_CALL, etc.)
          │
          ▼
    ReducerRegistry
          │
          ▼
  ReducerResult { operations, chunks }
          │
          ▼
    Executor (applyOperations)
          │
          ▼
    New MemoryState (immutable)
          │
          ├──► StorageProvider (persist)
          │
          └──► ContextBuilder (when needed)
                    │
                    ▼
              ContextMessage[] (for LLM)
```

## Quick Start

```typescript
import {
  createMemoryManager,
  createContextBuilder,
  createTokenizer,
  createDefaultReducerRegistry,
  MemoryStorageProvider,
} from '@team9/agent-framework';

// Setup
const storage = new MemoryStorageProvider();
const registry = createDefaultReducerRegistry();

const manager = createMemoryManager({
  storage,
  reducerRegistry: registry,
  autoCompactThreshold: 50,
});

// Dispatch event
const state = await manager.dispatch(threadId, {
  type: EventType.USER_INPUT,
  content: 'Hello!',
  timestamp: Date.now(),
});

// Build context for LLM
const builder = createContextBuilder(createTokenizer('gpt-4o'));
const context = builder.build(state, { maxTokens: 8000 });
// context.messages → send to LLM
```

## Key Concepts

### MemoryChunk

The atomic unit of memory, containing:

- `type` - ChunkType (SYSTEM, AGENT, WORKFLOW, etc.)
- `content` - Actual content data
- `retentionStrategy` - How long to keep (CRITICAL, COMPRESSIBLE, etc.)
- `metadata` - Additional metadata

### MemoryState

Immutable state container holding:

- `chunks` - Map of chunk ID → MemoryChunk
- `chunkIds` - Ordered list of chunk IDs
- `version` - State version for optimistic locking

### Event → Reducer → Operation Flow

1. Events describe what happened (USER_INPUT, TOOL_CALL, etc.)
2. Reducers transform events into Operations and Chunks
3. Executor applies Operations to create new State

## Modification Notice

When modifying files in this directory, please update the corresponding subdirectory's CLAUDE.md file. Each subdirectory has its own CLAUDE.md with detailed documentation.

See also:

- [types/CLAUDE.md](./types/CLAUDE.md)
- [reducer/CLAUDE.md](./reducer/CLAUDE.md)
- [storage/CLAUDE.md](./storage/CLAUDE.md)
- [manager/CLAUDE.md](./manager/CLAUDE.md)
- [context/CLAUDE.md](./context/CLAUDE.md)
- [compactor/CLAUDE.md](./compactor/CLAUDE.md)
- [tokenizer/CLAUDE.md](./tokenizer/CLAUDE.md)
