# @team9/agent-framework

Agent Framework - Core library providing memory management, context building, and debug control capabilities for AI agents.

## Package Info

- **Name**: `@team9/agent-framework`
- **Version**: 0.0.1
- **Entry**: `./src/index.ts`

## Dependencies

- `@paralleldrive/cuid2` - ID generation
- `js-tiktoken` - Token counting

## Directory Structure

```
agent-framework/
├── src/
│   ├── index.ts           # Main export
│   └── memory/            # Memory system (see memory/CLAUDE.md)
│       ├── types/         # Core type definitions
│       ├── utils/         # Utility functions
│       ├── factories/     # Factory functions
│       ├── executor/      # Operation executor
│       ├── reducer/       # Event reducers
│       ├── storage/       # Storage providers
│       ├── manager/       # Core orchestrators
│       ├── llm/           # LLM adapter interface
│       ├── compactor/     # Memory compaction
│       ├── context/       # Context builder
│       └── tokenizer/     # Token counting
└── docs/                  # Documentation
    ├── plan.md            # Original design plan
    ├── control-tools.md   # Control tools spec
    ├── events-and-reducers.md
    ├── memory-manager.md
    └── context-builder.md
```

## Quick Start

```typescript
import {
  // Types
  MemoryChunk,
  MemoryState,
  ChunkType,
  EventType,
  AgentEvent,

  // Factories
  createChunk,
  createInitialState,
  createAddOperation,

  // Core
  createMemoryManager,
  createContextBuilder,
  createTokenizer,
  createDefaultReducerRegistry,

  // Storage
  MemoryStorageProvider,
  PostgresStorageProvider,
} from '@team9/agent-framework';
```

## Core Concepts

### Event-Driven Architecture

```
Event → Reducer → Operations + Chunks → Executor → New State
```

### Memory Chunk Types

| Type         | Description             | Retention    |
| ------------ | ----------------------- | ------------ |
| SYSTEM       | System context          | CRITICAL     |
| AGENT        | User/Assistant messages | CRITICAL     |
| WORKFLOW     | Tool/Skill calls        | COMPRESSIBLE |
| ENVIRONMENT  | Tool results            | COMPRESSIBLE |
| WORKING_FLOW | Progress/Thinking       | DISPOSABLE   |
| DELEGATION   | Sub-agent communication | COMPRESSIBLE |
| OUTPUT       | Task completion         | CRITICAL     |

### Immutability

All state objects are immutable (frozen). Operations return new state objects.

## Documentation

Detailed documentation available in `docs/`:

- [plan.md](docs/plan.md) - Original architecture plan
- [events-and-reducers.md](docs/events-and-reducers.md) - Event system design
- [memory-manager.md](docs/memory-manager.md) - Manager architecture
- [context-builder.md](docs/context-builder.md) - Context building

## Modification Notice

**IMPORTANT**: When modifying any file in this project, please update the corresponding CLAUDE.md file in that directory:

- `src/memory/` changes → update [src/memory/CLAUDE.md](src/memory/CLAUDE.md)
- `src/memory/types/` changes → update [src/memory/types/CLAUDE.md](src/memory/types/CLAUDE.md)
- `src/memory/reducer/` changes → update [src/memory/reducer/CLAUDE.md](src/memory/reducer/CLAUDE.md)
- ... and so on for each subdirectory

Each subdirectory has its own CLAUDE.md with detailed documentation specific to that module.
