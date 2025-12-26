# Memory Factories

This directory contains factory functions for creating core Memory system objects.

## File Structure

| File                   | Description                                                                |
| ---------------------- | -------------------------------------------------------------------------- |
| `chunk.factory.ts`     | Creates MemoryChunk: `createChunk(options)`                                |
| `state.factory.ts`     | Creates MemoryState: `createInitialState()`, `createState()`               |
| `thread.factory.ts`    | Creates Thread: `createThread(options)`                                    |
| `operation.factory.ts` | Creates Operation: `createAddOperation()`, `createRemoveOperation()`, etc. |

## Usage Example

```typescript
import {
  createChunk,
  createInitialState,
  createAddOperation,
} from './factories';

// Create chunk
const chunk = createChunk({
  type: ChunkType.AGENT,
  content: { type: ChunkContentType.TEXT, text: 'Hello' },
  retentionStrategy: ChunkRetentionStrategy.CRITICAL,
});

// Create initial state
const state = createInitialState();

// Create operation
const operation = createAddOperation(chunk.id);
```

## Design Principles

1. All object creation goes through factory functions for consistency
2. Auto-generates IDs and timestamps
3. Returns frozen objects to ensure immutability

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Factory function changes should also update:

- `types/` - Related type definitions
- Reducers and managers that use these factories
