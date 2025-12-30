# Context Builder

Context Builder is responsible for converting MemoryState into LLM-ready message format, with each Chunk wrapped in corresponding XML tags.

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

### ChunkType.SYSTEM

```xml
<system_context id="chunk_xxx" priority="1000">
  System context content
</system_context>
```

### ChunkType.AGENT

Distinguished by role:

```xml
<!-- role: user -->
<user_message id="chunk_xxx" role="user">
  User message content
</user_message>

<!-- role: assistant -->
<assistant_response id="chunk_xxx" role="assistant">
  Assistant response content
</assistant_response>

<!-- role: assistant, action: clarification -->
<assistant_clarification id="chunk_xxx" role="assistant" action="clarification">
  Clarification question
</assistant_clarification>
```

### ChunkType.WORKFLOW

```xml
<!-- Tool Call -->
<tool_call id="chunk_xxx" action="tool_call" tool="read_file" call_id="call_123" status="pending">
  {"path": "/src/main.ts"}
</tool_call>

<!-- Skill Call -->
<skill_call id="chunk_xxx" action="skill_call" skill="code_review" call_id="call_456" status="pending">
  {"code": "..."}
</skill_call>
```

### ChunkType.DELEGATION

```xml
<!-- Spawn SubAgent -->
<spawn_subagent id="chunk_xxx" subagent_id="agent_123" agent_type="researcher">
  {"task": "Search for..."}
</spawn_subagent>

<!-- Message to SubAgent -->
<message_to_subagent id="chunk_xxx" subagent_id="agent_123">
  Please continue research...
</message_to_subagent>

<!-- SubAgent Result -->
<subagent_result id="chunk_xxx" subagent_id="agent_123" success="true">
  Research results...
</subagent_result>

<!-- Parent Agent Message -->
<parent_agent_message id="chunk_xxx" parent_agent_id="agent_000">
  Parent task instruction
</parent_agent_message>
```

### ChunkType.ENVIRONMENT

```xml
<!-- Tool Result -->
<tool_result id="chunk_xxx" tool="read_file" call_id="call_123" success="true">
  File content...
</tool_result>

<!-- Tool Error -->
<tool_result id="chunk_xxx" tool="read_file" call_id="call_123" success="false" error="true">
  File not found
</tool_result>

<!-- Skill Result -->
<skill_result id="chunk_xxx" skill="code_review" call_id="call_456" success="true">
  Review results...
</skill_result>
```

### ChunkType.WORKING_FLOW

```xml
<!-- Compacted Progress Summary -->
<progress_summary id="chunk_xxx" compacted_at="1703..." original_count="15">
  ## Progress Summary
  ### Completed Actions
  - Action 1
  - Action 2
</progress_summary>

<!-- TODO Update -->
<todo_update id="chunk_xxx" action="todo_set">
  {"todos": [...]}
</todo_update>

<!-- Thinking -->
<thinking id="chunk_xxx" subtype="THINKING">
  Thinking process...
</thinking>

<!-- User Intervention -->
<user_intervention id="chunk_xxx" subtype="USER">
  User intervention during process
</user_intervention>
```

### ChunkType.OUTPUT

```xml
<!-- Task Completed -->
<task_completed id="chunk_xxx">
  {"result": "...", "summary": "..."}
</task_completed>

<!-- Task Abandoned -->
<task_abandoned id="chunk_xxx" reason="Unable to complete">
  {"partialResult": "..."}
</task_abandoned>

<!-- Task Terminated -->
<task_terminated id="chunk_xxx" terminated_by="user">
  Task was terminated
</task_terminated>
```

## Usage Examples

### Basic Usage

```typescript
import { ContextBuilder, createContextBuilder } from '@team9/agent-framework';

const builder = createContextBuilder();

// Get current state
const state = await memoryManager.getCurrentState(threadId);

// Build context
const result = builder.build(state, {
  maxTokens: 8000,
  systemPrompt: 'You are a helpful assistant.',
});

// result.messages can be used directly for LLM calls
const response = await llm.chat({
  messages: result.messages,
});
```

### Using Tokenizer for Precise Token Counting

```typescript
import { createContextBuilder, createTokenizer } from '@team9/agent-framework';

// Create tokenizer for specific model
const tokenizer = createTokenizer('gpt-4o');

// Method 1: Pass default tokenizer at construction
const builder = createContextBuilder(tokenizer);

// Method 2: Pass at build time
const result = builder.build(state, {
  maxTokens: 8000,
  tokenizer: tokenizer,
});

// Check if token count is exact
console.log('Token count:', result.tokenCount);
console.log('Is exact:', result.tokenCountExact); // true if tokenizer was used
```

### Usage with Options

```typescript
const result = builder.build(state, {
  // Token limit
  maxTokens: 4000,

  // Use tokenizer for precise counting
  tokenizer: createTokenizer('gpt-4o'),

  // Custom system prompt
  systemPrompt: `You are an expert developer.

<task>
${currentTask}
</task>`,

  // Whether to include system blocks
  includeSystem: true,

  // Whether to include environment blocks (tool results, etc.)
  includeEnvironment: true,

  // Exclude specific types
  excludeTypes: [ChunkType.OUTPUT],

  // Only include specific chunks
  includeOnlyChunkIds: ['chunk_1', 'chunk_2'],
});

console.log('Token count:', result.tokenCount);
console.log('Included chunks:', result.includedChunkIds);
console.log('Excluded chunks:', result.excludedChunkIds);
```

### Custom Renderer

```typescript
import {
  IChunkRenderer,
  ContextMessageRole,
  MemoryChunk,
} from '@team9/agent-framework';

class CustomChunkRenderer implements IChunkRenderer {
  canRender(chunk: MemoryChunk): boolean {
    // Only handle specific custom chunks
    return chunk.metadata.custom?.myCustomType === true;
  }

  getRole(chunk: MemoryChunk): ContextMessageRole {
    return 'assistant';
  }

  render(chunk: MemoryChunk): string {
    const content = chunk.content;
    return `<my_custom_tag id="${chunk.id}">
${JSON.stringify(content)}
</my_custom_tag>`;
  }
}

// Register custom renderer (takes priority over default renderers)
builder.registerRenderer(new CustomChunkRenderer());
```

## ContextBuildResult

```typescript
interface ContextBuildResult {
  /** List of messages to send to LLM */
  messages: ContextMessage[];

  /** Token count (exact or estimated) */
  tokenCount: number;

  /** Whether count is exact (true=used tokenizer, false=estimated) */
  tokenCountExact: boolean;

  /** Included chunk IDs */
  includedChunkIds: string[];

  /** Excluded chunk IDs (e.g., exceeded token limit) */
  excludedChunkIds: string[];
}
```

## Message Grouping

Context Builder merges consecutive chunks with the same role into a single message:

```
Chunk 1 (user)   ──┐
Chunk 2 (user)   ──┼──► Message 1: role=user
Chunk 3 (assistant) ──► Message 2: role=assistant
Chunk 4 (user)   ──► Message 3: role=user
Chunk 5 (user)   ──┘
```

This reduces message count while maintaining correct conversation structure.

## Token Counting

### Exact Counting (Using Tokenizer)

Uses `js-tiktoken` to provide exact token counting:

```typescript
import { createTokenizer } from '@team9/agent-framework';

// Supported models
const tokenizer = createTokenizer('gpt-4o'); // o200k_base encoding
const tokenizer = createTokenizer('gpt-4'); // cl100k_base encoding
const tokenizer = createTokenizer('gpt-3.5-turbo'); // cl100k_base encoding

// Claude models use cl100k_base as approximation
const tokenizer = createTokenizer('claude-3-5-sonnet-20241022');
```

### Estimated Counting (Without Tokenizer)

If no tokenizer is provided, uses simple character count/4 algorithm for estimation.

### Token Limit Handling

When `maxTokens` is set:

1. Process chunks in order
2. Accumulate token count for each chunk
3. Chunks exceeding limit are placed in `excludedChunkIds`
4. Result shows which chunks were excluded
