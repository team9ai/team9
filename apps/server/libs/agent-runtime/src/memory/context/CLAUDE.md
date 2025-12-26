# Context Builder

This directory contains the Context Builder for converting MemoryState to LLM-ready messages.

## File Structure

| File                 | Description                                                                          |
| -------------------- | ------------------------------------------------------------------------------------ |
| `context.types.ts`   | Interfaces: IContextBuilder, IChunkRenderer, ContextBuildOptions, ContextBuildResult |
| `chunk-renderers.ts` | Default renderers for each ChunkType (XML tag output)                                |
| `context-builder.ts` | ContextBuilder implementation                                                        |

## Architecture

```
MemoryState
     │
     ▼
┌─────────────────────────────────────┐
│          ContextBuilder             │
│  ┌───────────────────────────────┐  │
│  │     Chunk Renderers           │  │
│  │  ┌─────────┐ ┌─────────────┐  │  │
│  │  │ System  │ │    Agent    │  │  │
│  │  ├─────────┤ ├─────────────┤  │  │
│  │  │Workflow │ │ Delegation  │  │  │
│  │  ├─────────┤ ├─────────────┤  │  │
│  │  │Environ. │ │WorkingFlow  │  │  │
│  │  ├─────────┤ ├─────────────┤  │  │
│  │  │ Output  │ │   Custom    │  │  │
│  │  └─────────┘ └─────────────┘  │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
     │
     ▼
ContextMessage[] (role + content)
```

## XML Tag Mapping

Each ChunkType is rendered with corresponding XML tags:

| ChunkType         | XML Tag Example                                                  |
| ----------------- | ---------------------------------------------------------------- |
| SYSTEM            | `<system_context id="xxx">...</system_context>`                  |
| AGENT (user)      | `<user_message id="xxx">...</user_message>`                      |
| AGENT (assistant) | `<assistant_response id="xxx">...</assistant_response>`          |
| WORKFLOW          | `<tool_call id="xxx" tool="read_file">...</tool_call>`           |
| DELEGATION        | `<spawn_subagent id="xxx" agent_type="...">...</spawn_subagent>` |
| ENVIRONMENT       | `<tool_result id="xxx" success="true">...</tool_result>`         |
| WORKING_FLOW      | `<thinking id="xxx">...</thinking>`                              |
| OUTPUT            | `<task_completed id="xxx">...</task_completed>`                  |

## Usage

```typescript
import { createContextBuilder, createTokenizer } from '@team9/agent-runtime';

const builder = createContextBuilder();
const tokenizer = createTokenizer('gpt-4o');

const result = builder.build(state, {
  maxTokens: 8000,
  tokenizer: tokenizer,
  systemPrompt: 'You are a helpful assistant.',
});

// result.messages - ready for LLM
// result.tokenCount - accurate token count
// result.tokenCountExact - true if tokenizer was used
```

## Custom Renderers

```typescript
class MyCustomRenderer implements IChunkRenderer {
  canRender(chunk: MemoryChunk): boolean {
    return chunk.metadata.custom?.myType === true;
  }

  getRole(chunk: MemoryChunk): ContextMessageRole {
    return 'assistant';
  }

  render(chunk: MemoryChunk): string {
    return `<my_tag>${chunk.content}</my_tag>`;
  }
}

builder.registerRenderer(new MyCustomRenderer());
```

## Modification Notice

When modifying files in this directory, please update this CLAUDE.md accordingly. Changes may affect:

- LLM context format
- Token counting accuracy
- Message grouping behavior
