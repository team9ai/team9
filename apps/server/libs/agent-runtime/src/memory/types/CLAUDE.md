# Memory Types

This directory defines core type definitions for the Agent Memory Context system.

## File Structure

| File                 | Description                                                                          |
| -------------------- | ------------------------------------------------------------------------------------ |
| `chunk.types.ts`     | Memory Chunk types: ChunkType, ChunkContentType, ChunkRetentionStrategy, MemoryChunk |
| `state.types.ts`     | Memory State types: MemoryState (immutable state container)                          |
| `operation.types.ts` | Operation types: OperationType, Operation (ADD, REMOVE, UPDATE, COMPACT, CLEAR)      |
| `thread.types.ts`    | Thread types: Thread, ThreadMetadata (supports multi-thread conversations)           |
| `event.types.ts`     | Event type definitions: EventType enum (27+ event types), AgentEvent union type      |

## Core Concepts

### ChunkType

- `SYSTEM` - System context
- `AGENT` - Agent messages (user/assistant)
- `WORKFLOW` - Workflow operations (tool calls, skill calls)
- `DELEGATION` - Sub-agent delegation
- `ENVIRONMENT` - Environment feedback (tool results)
- `WORKING_FLOW` - Work progress (compressible)
- `OUTPUT` - Task output

### ChunkRetentionStrategy

- `CRITICAL` - Critical content, cannot be compressed
- `COMPRESSIBLE` - Can be compressed
- `BATCH_COMPRESSIBLE` - Can be batch compressed
- `DISPOSABLE` - Can be discarded
- `EPHEMERAL` - Temporary

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Type changes may affect:

- `factories/` - Factory functions
- `reducer/` - Event handlers
- `context/` - Context builder
