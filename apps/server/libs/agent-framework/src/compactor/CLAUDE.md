# Memory Compactor

This directory contains Compactor implementations for compressing memory chunks using LLM.

## File Structure

| File                           | Description                                           |
| ------------------------------ | ----------------------------------------------------- |
| `compactor.types.ts`           | ICompactor interface and related types                |
| `working-history.compactor.ts` | WorkingHistoryCompactor: compacts conversation chunks |

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

## WorkingHistoryCompactor

Compacts conversation history chunks (thinking, messages, actions, responses) into summaries.

### Prompt Format

```xml
<context>
  <task_goal>User's task goal</task_goal>
  <progress_summary>Previous progress</progress_summary>
</context>

<working_history_to_compact>
  <entry index="1" type="THINKING" timestamp="...">
    Content here...
  </entry>
  ...
</working_history_to_compact>
```

### Usage

```typescript
import { WorkingHistoryCompactor } from './compactor';

const compactor = new WorkingHistoryCompactor(llmAdapter, config);

if (compactor.canCompact(chunks)) {
  const result = await compactor.compact(chunks, context);
  // result: { compactedChunk, originalChunkIds, tokensBefore, tokensAfter }
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
