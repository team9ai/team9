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
│   ├── tools/             # Tool system (see tools/CLAUDE.md)
│   │   ├── tool.types.ts  # Tool type definitions
│   │   ├── tool.registry.ts # Tool registration & execution
│   │   ├── index.ts       # Tool exports
│   │   └── control/       # Control tools (framework built-in)
│   │       ├── ask-user.tool.ts
│   │       ├── output.tool.ts
│   │       ├── task-complete.tool.ts
│   │       ├── task-abandon.tool.ts
│   │       ├── wait-parent.tool.ts
│   │       ├── invoke-tool.tool.ts
│   │       └── index.ts
│   ├── components/        # Component system (see components/CLAUDE.md)
│   │   ├── component.types.ts    # Component type definitions
│   │   ├── component-renderer.ts # Converts components to chunks + tools
│   │   └── index.ts              # Component exports
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

  // Tools
  ToolRegistry,
  createDefaultToolRegistry,
  controlTools,
  invokeToolTool,

  // Components
  ComponentRenderer,
  createComponentRenderer,
  createSystemComponent,
  createAgentComponent,
  createWorkflowComponent,
} from '@team9/agent-framework';
```

## Core Concepts

### Event-Driven Architecture

```
Event → Reducer → Operations + Chunks → Executor → New State
```

### Execution Modes

- `auto` - Events are processed immediately as they arrive
- `stepping` - Events are queued until `step()` is called manually

### Event Dispatch Strategies

Controls how events are processed when agent is busy:

- `queue` - (default) Queue the event, process after current operation completes
- `interrupt` - Cancel current generation, immediately process new event
- `terminate` - End the agent's event loop (used by TASK_COMPLETED, etc.)
- `silent` - Store only, do not trigger processing (reserved)

### Agent Status

Agent lifecycle status (defined in `types/agent.types.ts`):

- `processing` - Actively generating content or executing LLM calls
- `waiting_internal` - Waiting for sub-agent or tool to return
- `awaiting_input` - Waiting for external input (human/external system)
- `paused` - Paused in stepping mode, waiting for manual step
- `completed` - Task completed
- `error` - Encountered an error

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

**IMPORTANT**: When modifying any file in this project, you MUST update the corresponding CLAUDE.md file in that directory. This is a critical practice for maintaining documentation consistency.

### Rules

1. **Every directory MUST have a CLAUDE.md** - If a directory doesn't have one, create it
2. **Update on every change** - Any code modification requires corresponding CLAUDE.md update
3. **Keep synchronized** - Documentation must reflect current implementation

### Why Update CLAUDE.md?

1. **AI Context** - CLAUDE.md files provide essential context for AI assistants working on the codebase
2. **Living Documentation** - Keeps documentation synchronized with actual implementation
3. **Onboarding** - Helps new developers (and AI) understand module purposes quickly
4. **Change Tracking** - Documents architectural decisions alongside code changes

### What to Update

When making code changes, update the relevant CLAUDE.md with:

- New functions, classes, or interfaces added
- Changed behavior or API signatures
- New configuration options or parameters
- Usage examples if applicable
- Any breaking changes

### Directory Mapping

| Directory         | CLAUDE.md Location                                   |
| ----------------- | ---------------------------------------------------- |
| `src/tools/`      | [src/tools/CLAUDE.md](src/tools/CLAUDE.md)           |
| `src/components/` | [src/components/CLAUDE.md](src/components/CLAUDE.md) |
| `src/types/`      | [src/types/CLAUDE.md](src/types/CLAUDE.md)           |
| `src/manager/`    | [src/manager/CLAUDE.md](src/manager/CLAUDE.md)       |
| `src/reducer/`    | [src/reducer/CLAUDE.md](src/reducer/CLAUDE.md)       |
| `src/debug/`      | [src/debug/CLAUDE.md](src/debug/CLAUDE.md)           |
| `src/blueprint/`  | [src/blueprint/CLAUDE.md](src/blueprint/CLAUDE.md)   |
| `src/compactor/`  | [src/compactor/CLAUDE.md](src/compactor/CLAUDE.md)   |
| `src/context/`    | [src/context/CLAUDE.md](src/context/CLAUDE.md)       |
| `src/storage/`    | [src/storage/CLAUDE.md](src/storage/CLAUDE.md)       |
| `src/llm/`        | [src/llm/CLAUDE.md](src/llm/CLAUDE.md)               |
| `src/factories/`  | [src/factories/CLAUDE.md](src/factories/CLAUDE.md)   |
| `src/executor/`   | [src/executor/CLAUDE.md](src/executor/CLAUDE.md)     |
| `src/tokenizer/`  | [src/tokenizer/CLAUDE.md](src/tokenizer/CLAUDE.md)   |
| `src/utils/`      | [src/utils/CLAUDE.md](src/utils/CLAUDE.md)           |

Each subdirectory has its own CLAUDE.md with detailed documentation specific to that module. **If a CLAUDE.md doesn't exist for a directory you're modifying, create one first.**
