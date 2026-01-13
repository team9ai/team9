# Memory Reducer

This directory contains the Reducer system responsible for transforming Events into Operations and Chunks.

## File Structure

| File                  | Description                                                                       |
| --------------------- | --------------------------------------------------------------------------------- |
| `reducer.types.ts`    | Reducer interfaces: EventReducer, ReducerResult                                   |
| `reducer.registry.ts` | ReducerRegistry: registers and dispatches to reducers                             |
| `reducers/`           | Concrete reducer implementations (see [reducers/CLAUDE.md](./reducers/CLAUDE.md)) |

## Architecture

```
Event
   │
   ▼
┌─────────────────────────────────────┐
│          ReducerRegistry            │
│  ┌─────────┐ ┌─────────┐ ┌───────┐  │
│  │ Input   │ │Response │ │Control│  │
│  │ Reducer │ │ Reducer │ │Reducer│  │
│  └─────────┘ └─────────┘ └───────┘  │
│  ┌─────────┐ ┌─────────┐            │
│  │  LLM    │ │  Error  │            │
│  │ Reducer │ │ Reducer │            │
│  └─────────┘ └─────────┘            │
└─────────────────────────────────────┘
   │
   ▼
ReducerResult { operations, chunks }
```

## Usage

```typescript
import { ReducerRegistry, createDefaultReducerRegistry } from './reducer';

// Create registry with default reducers
const registry = createDefaultReducerRegistry();

// Process event
const event: BaseEvent = { type: EventType.USER_INPUT, ... };
const result = registry.reduce(state, event);

// result.operations - operations to apply to state
// result.chunks - new chunks to add
```

## Design Principles

1. **Pure Functions**: Reducers are pure - same input always produces same output
2. **Single Responsibility**: Each reducer handles specific event types
3. **Immutability**: Reducers never mutate input state
4. **Extensibility**: New reducers can be registered dynamically

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Changes should also update:

- `reducers/CLAUDE.md` for reducer implementation changes
- `types/event.types.ts` when adding new events
