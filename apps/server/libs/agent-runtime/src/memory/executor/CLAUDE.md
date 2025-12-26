# Memory Executor

This directory contains the Operation executor, responsible for applying Operations to MemoryState.

## File Structure

| File                    | Description                                                 |
| ----------------------- | ----------------------------------------------------------- |
| `operation.executor.ts` | Operation executor: `applyOperation()`, `applyOperations()` |

## Core Functions

### applyOperation

Applies a single Operation to State, returns a new immutable State.

```typescript
import { applyOperation } from './executor';

const newState = applyOperation(state, operation, chunk);
```

### applyOperations

Batch applies multiple Operations.

```typescript
const newState = applyOperations(state, operations, chunks);
```

## Supported Operation Types

| Operation | Description                                              |
| --------- | -------------------------------------------------------- |
| `ADD`     | Add new chunk to state                                   |
| `REMOVE`  | Remove chunk from state                                  |
| `UPDATE`  | Update existing chunk                                    |
| `COMPACT` | Compact operation (replace multiple chunks with new one) |
| `CLEAR`   | Clear state                                              |

## Immutability Guarantee

All operations return new frozen State objects; the original State is not modified.

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Executor changes must ensure:

- Immutability is maintained
- Related tests are updated
