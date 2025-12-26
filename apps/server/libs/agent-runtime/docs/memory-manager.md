# Memory Manager

Memory Manager 是 Agent 内存系统的核心调度器，负责协调事件处理、状态管理和内存压缩。

## 架构概览

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MemoryManager                                   │
│  ┌─────────────┐  ┌──────────────────┐  ┌─────────────┐  ┌───────────────┐  │
│  │ EventQueue  │  │ ReducerRegistry  │  │ ThreadMgr   │  │  Compactors   │  │
│  │  (per-thread)│  │                  │  │             │  │               │  │
│  └─────────────┘  └──────────────────┘  └─────────────┘  └───────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                          ┌─────────────────┐
                          │ StorageProvider │
                          │  (InMemory/PG)  │
                          └─────────────────┘
```

## 事件处理流程

### 正常流程

```
Event → dispatch()
           │
           ▼
    ┌──────────────┐
    │ Queue blocked?│
    └──────┬───────┘
           │
     No    │    Yes
     ▼     │     ▼
processEvent()  enqueue() → wait for unblock
     │
     ▼
ReducerRegistry.reduce(state, event)
     │
     ▼
Operations + Chunks
     │
     ▼
ThreadManager.applyReducerResult()
     │
     ▼
Executor.applyOperations()
     │
     ▼
New State (persisted)
     │
     ▼
checkAutoCompaction()
     │
     ▼
[if threshold reached] → triggerCompaction() (background)
```

### 压缩流程

```
triggerCompaction(threadId, chunks?)
           │
           ▼
    block(COMPACTING)  ← 新事件进入队列等待
           │
           ▼
    Find suitable compactor
           │
           ▼
    Build CompactionContext
    (state, taskGoal, progressSummary)
           │
           ▼
    compactor.compact(chunks, context)
           │
           ▼
    LLM generates summary
           │
           ▼
    Create BATCH_REPLACE operation
    (replace original chunks with compacted chunk)
           │
           ▼
    ThreadManager.applyReducerResult()
           │
           ▼
    unblock()
           │
           ▼
    processQueue()  ← 处理等待中的事件
```

## 阻塞机制

### BlockingReason

| Reason       | Description      |
| ------------ | ---------------- |
| `COMPACTING` | 压缩操作进行中   |
| `PAUSED`     | 手动暂停（预留） |

### EventQueue 行为

- **未阻塞时**: 事件立即处理
- **阻塞时**: 事件入队，返回 Promise，等待阻塞解除后处理
- **解除阻塞后**: 自动处理队列中的所有事件

```typescript
// 检查是否阻塞
manager.isBlocked(threadId);

// 获取阻塞原因
manager.getBlockingReason(threadId);
```

## Compaction (压缩)

### 压缩策略

根据 `ChunkRetentionStrategy` 决定哪些 chunks 可以压缩：

| Strategy             | Compactable | Description      |
| -------------------- | ----------- | ---------------- |
| `CRITICAL`           | No          | 必须保留，不压缩 |
| `COMPRESSIBLE`       | Yes         | 可单独压缩       |
| `BATCH_COMPRESSIBLE` | Yes         | 可批量压缩       |
| `DISPOSABLE`         | Yes         | 可丢弃，优先压缩 |
| `EPHEMERAL`          | N/A         | 会话结束后丢弃   |

### 自动压缩

当可压缩的 WORKING_FLOW chunks 数量达到阈值时自动触发：

```typescript
const manager = new MemoryManager(storage, registry, llmAdapter, {
  llm: { compactModel: 'gpt-4o-mini' },
  autoCompactEnabled: true, // 默认 true
  autoCompactThreshold: 20, // 默认 20 个 chunks
});
```

### 手动压缩

```typescript
// 压缩所有可压缩的 chunks
await manager.triggerCompaction(threadId);

// 压缩指定 chunks
await manager.triggerCompaction(threadId, specificChunks);
```

### WorkingFlowCompactor

专门用于压缩 WORKING_FLOW 类型的 chunks：

**输入格式 (XML)**:

```xml
<context>
  <task_goal>用户的任务目标</task_goal>
  <progress_summary>之前的进度摘要</progress_summary>
  <system_context>系统上下文</system_context>
</context>

<working_flow_to_compact>
  <entry index="1" subtype="THINKING" timestamp="...">
    思考内容...
  </entry>
  <entry index="2" subtype="AGENT_ACTION" timestamp="...">
    动作内容...
  </entry>
</working_flow_to_compact>
```

**输出格式**:

```markdown
## Progress Summary

### Completed Actions

- 已完成的操作列表

### Attempted Approaches

- 尝试过的方法（成功/失败）

### Current State

当前状态描述

### Key Information

- 重要信息、文件路径、决策

### Next Steps

- 下一步要做的事情
```

## 使用示例

### 初始化

```typescript
import {
  MemoryManager,
  DefaultReducerRegistry,
  InMemoryStorageProvider,
} from '@team9/agent-runtime';

// 创建 LLM 适配器（实现 ILLMAdapter 接口）
const llmAdapter: ILLMAdapter = {
  async complete(request) {
    // 调用 ai-client 或其他 LLM 服务
    const response = await aiClient.chat({
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens,
    });
    return {
      content: response.content,
      usage: response.usage,
    };
  },
};

// 创建 MemoryManager
const manager = new MemoryManager(
  new InMemoryStorageProvider(),
  new DefaultReducerRegistry(),
  llmAdapter,
  {
    llm: {
      compactModel: 'gpt-4o-mini',
      compactTemperature: 0.3,
      compactMaxTokens: 2000,
    },
    autoCompactEnabled: true,
    autoCompactThreshold: 20,
  },
);
```

### 处理事件

```typescript
// 创建线程
const { thread, initialState } = await manager.createThread();

// 派发事件
const result = await manager.dispatch(thread.id, {
  type: EventType.USER_MESSAGE,
  timestamp: Date.now(),
  content: 'Hello, agent!',
});

// 批量派发
await manager.dispatchAll(thread.id, [event1, event2, event3]);
```

### 自定义 Compactor

```typescript
import {
  ICompactor,
  CompactionResult,
  CompactionContext,
} from '@team9/agent-runtime';

class CustomCompactor implements ICompactor {
  canCompact(chunks: MemoryChunk[]): boolean {
    // 判断是否可以处理这些 chunks
    return chunks.every((c) => c.type === ChunkType.ENVIRONMENT);
  }

  async compact(
    chunks: MemoryChunk[],
    context: CompactionContext,
  ): Promise<CompactionResult> {
    // 自定义压缩逻辑
    // ...
  }
}

manager.registerCompactor(new CustomCompactor());
```

## 配置参考

### MemoryManagerConfig

| Field                  | Type        | Default  | Description                   |
| ---------------------- | ----------- | -------- | ----------------------------- |
| `llm`                  | `LLMConfig` | required | LLM 配置                      |
| `autoCompactEnabled`   | `boolean`   | `true`   | 是否启用自动压缩              |
| `autoCompactThreshold` | `number`    | `20`     | 触发自动压缩的 chunk 数量阈值 |

### LLMConfig

| Field                | Type     | Default  | Description       |
| -------------------- | -------- | -------- | ----------------- |
| `compactModel`       | `string` | required | 压缩使用的模型    |
| `compactTemperature` | `number` | `0.3`    | 温度参数          |
| `compactMaxTokens`   | `number` | `2000`   | 最大输出 token 数 |
