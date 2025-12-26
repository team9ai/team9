# Memory Compactor

This directory contains Compactor implementations for compressing memory chunks using LLM.

## File Structure

| File                        | Description                                        |
| --------------------------- | -------------------------------------------------- |
| `compactor.types.ts`        | ICompactor interface and related types             |
| `working-flow.compactor.ts` | WorkingFlowCompactor: compacts WORKING_FLOW chunks |

## Architecture

```
Chunks to Compact
       │
       ▼
┌─────────────────────────────────────┐
│           Compactor                  │
│  ┌───────────────────────────────┐  │
│  │     Prompt Generation         │  │
│  │  (XML-formatted chunk data)   │  │
│  └───────────────────────────────┘  │
│                │                     │
│                ▼                     │
│  ┌───────────────────────────────┐  │
│  │        LLM Adapter            │  │
│  │   (Summarization Request)     │  │
│  └───────────────────────────────┘  │
│                │                     │
│                ▼                     │
│  ┌───────────────────────────────┐  │
│  │    Summary Chunk Creation     │  │
│  │  (WORKING_FLOW, COMPRESSIBLE) │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
       │
       ▼
Single Summary Chunk
```

## ICompactor Interface

```typescript
interface ICompactor {
  readonly chunkType: ChunkType;
  canCompact(chunks: MemoryChunk[]): boolean;
  compact(chunks: MemoryChunk[]): Promise<MemoryChunk>;
}
```

## WorkingFlowCompactor

Compacts WORKING_FLOW chunks (thinking, todo updates, progress) into summaries.

### Prompt Format

```xml
<compaction_request>
  <instruction>Summarize the following workflow events...</instruction>
  <chunks>
    <chunk id="xxx" type="WORKING_FLOW" subtype="THINKING">
      Content here...
    </chunk>
    ...
  </chunks>
</compaction_request>
```

### Usage

```typescript
import { WorkingFlowCompactor } from './compactor';

const compactor = new WorkingFlowCompactor(llmAdapter);

if (compactor.canCompact(chunks)) {
  const summaryChunk = await compactor.compact(chunks);
  // Apply COMPACT operation to replace chunks with summary
}
```

## Adding New Compactors

1. Create `xxx.compactor.ts`
2. Implement `ICompactor` interface
3. Define appropriate prompt for the chunk type
4. Register in MemoryManager
5. Update this CLAUDE.md

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Compactor changes may affect:

- LLM prompt quality
- Compression ratio
- Memory efficiency
