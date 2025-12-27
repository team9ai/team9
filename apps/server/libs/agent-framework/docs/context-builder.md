# Context Builder

Context Builder 负责将 MemoryState 转换为 LLM 可用的消息格式，每个 Chunk 都被包装在对应的 XML 标签内。

## 架构

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

## XML 标签映射

### ChunkType.SYSTEM

```xml
<system_context id="chunk_xxx" priority="1000">
  系统上下文内容
</system_context>
```

### ChunkType.AGENT

根据 role 区分：

```xml
<!-- role: user -->
<user_message id="chunk_xxx" role="user">
  用户消息内容
</user_message>

<!-- role: assistant -->
<assistant_response id="chunk_xxx" role="assistant">
  助手回复内容
</assistant_response>

<!-- role: assistant, action: clarification -->
<assistant_clarification id="chunk_xxx" role="assistant" action="clarification">
  澄清问题
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
  请继续调研...
</message_to_subagent>

<!-- SubAgent Result -->
<subagent_result id="chunk_xxx" subagent_id="agent_123" success="true">
  调研结果...
</subagent_result>

<!-- Parent Agent Message -->
<parent_agent_message id="chunk_xxx" parent_agent_id="agent_000">
  父级任务指令
</parent_agent_message>
```

### ChunkType.ENVIRONMENT

```xml
<!-- Tool Result -->
<tool_result id="chunk_xxx" tool="read_file" call_id="call_123" success="true">
  文件内容...
</tool_result>

<!-- Tool Error -->
<tool_result id="chunk_xxx" tool="read_file" call_id="call_123" success="false" error="true">
  File not found
</tool_result>

<!-- Skill Result -->
<skill_result id="chunk_xxx" skill="code_review" call_id="call_456" success="true">
  Review 结果...
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
  思考过程...
</thinking>

<!-- User Intervention -->
<user_intervention id="chunk_xxx" subtype="USER">
  用户中途的干预
</user_intervention>
```

### ChunkType.OUTPUT

```xml
<!-- Task Completed -->
<task_completed id="chunk_xxx">
  {"result": "...", "summary": "..."}
</task_completed>

<!-- Task Abandoned -->
<task_abandoned id="chunk_xxx" reason="无法完成">
  {"partialResult": "..."}
</task_abandoned>

<!-- Task Terminated -->
<task_terminated id="chunk_xxx" terminated_by="user">
  任务被终止
</task_terminated>
```

## 使用示例

### 基本使用

```typescript
import { ContextBuilder, createContextBuilder } from '@team9/agent-framework';

const builder = createContextBuilder();

// 获取当前 state
const state = await memoryManager.getCurrentState(threadId);

// 构建上下文
const result = builder.build(state, {
  maxTokens: 8000,
  systemPrompt: 'You are a helpful assistant.',
});

// result.messages 可直接用于 LLM 调用
const response = await llm.chat({
  messages: result.messages,
});
```

### 使用 Tokenizer 进行精确 Token 计数

```typescript
import { createContextBuilder, createTokenizer } from '@team9/agent-framework';

// 创建针对特定模型的 tokenizer
const tokenizer = createTokenizer('gpt-4o');

// 方式 1: 在构造时传入默认 tokenizer
const builder = createContextBuilder(tokenizer);

// 方式 2: 在 build 时传入
const result = builder.build(state, {
  maxTokens: 8000,
  tokenizer: tokenizer,
});

// 检查 token 计数是否精确
console.log('Token count:', result.tokenCount);
console.log('Is exact:', result.tokenCountExact); // true if tokenizer was used
```

### 带选项的使用

```typescript
const result = builder.build(state, {
  // Token 限制
  maxTokens: 4000,

  // 使用 tokenizer 进行精确计数
  tokenizer: createTokenizer('gpt-4o'),

  // 自定义系统提示
  systemPrompt: `You are an expert developer.

<task>
${currentTask}
</task>`,

  // 是否包含系统块
  includeSystem: true,

  // 是否包含环境块（工具结果等）
  includeEnvironment: true,

  // 排除特定类型
  excludeTypes: [ChunkType.OUTPUT],

  // 只包含特定 chunks
  includeOnlyChunkIds: ['chunk_1', 'chunk_2'],
});

console.log('Token count:', result.tokenCount);
console.log('Included chunks:', result.includedChunkIds);
console.log('Excluded chunks:', result.excludedChunkIds);
```

### 自定义 Renderer

```typescript
import {
  IChunkRenderer,
  ContextMessageRole,
  MemoryChunk,
} from '@team9/agent-framework';

class CustomChunkRenderer implements IChunkRenderer {
  canRender(chunk: MemoryChunk): boolean {
    // 只处理特定的自定义 chunk
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

// 注册自定义 renderer（优先于默认 renderers）
builder.registerRenderer(new CustomChunkRenderer());
```

## ContextBuildResult

```typescript
interface ContextBuildResult {
  /** 发送给 LLM 的消息列表 */
  messages: ContextMessage[];

  /** Token 数量 (精确或估算) */
  tokenCount: number;

  /** 是否为精确计数 (true=使用了tokenizer, false=估算) */
  tokenCountExact: boolean;

  /** 被包含的 chunk IDs */
  includedChunkIds: string[];

  /** 被排除的 chunk IDs（如超出 token 限制） */
  excludedChunkIds: string[];
}
```

## 消息分组

Context Builder 会将连续相同角色的 chunks 合并到同一个消息中：

```
Chunk 1 (user)   ──┐
Chunk 2 (user)   ──┼──► Message 1: role=user
Chunk 3 (assistant) ──► Message 2: role=assistant
Chunk 4 (user)   ──► Message 3: role=user
Chunk 5 (user)   ──┘
```

这样可以减少消息数量，同时保持正确的对话结构。

## Token 计数

### 精确计数 (使用 Tokenizer)

使用 `js-tiktoken` 提供精确的 token 计数：

```typescript
import { createTokenizer } from '@team9/agent-framework';

// 支持的模型
const tokenizer = createTokenizer('gpt-4o'); // o200k_base encoding
const tokenizer = createTokenizer('gpt-4'); // cl100k_base encoding
const tokenizer = createTokenizer('gpt-3.5-turbo'); // cl100k_base encoding

// Claude 模型使用 cl100k_base 作为近似值
const tokenizer = createTokenizer('claude-3-5-sonnet-20241022');
```

### 估算计数 (无 Tokenizer)

如果不提供 tokenizer，使用简单的字符数/4 算法进行估算。

### Token 限制处理

当设置 `maxTokens` 时：

1. 按顺序处理 chunks
2. 累加每个 chunk 的 token 数
3. 超出限制的 chunks 被放入 `excludedChunkIds`
4. 返回结果中可以看到哪些被排除了
