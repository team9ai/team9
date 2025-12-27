# Memory Utils

This directory contains utility functions for the Memory system.

## File Structure

| File          | Description                                                                       |
| ------------- | --------------------------------------------------------------------------------- |
| `id.utils.ts` | ID generation utilities: generateChunkId, generateThreadId, generateEventId, etc. |

## Usage

```typescript
import { generateChunkId, generateThreadId } from './utils';

const chunkId = generateChunkId(); // chunk_xxx
const threadId = generateThreadId(); // thread_xxx
```

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly.
