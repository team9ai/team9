# Agent Framework 架构文档

本文档详细介绍 agent-framework 库的目录结构、核心概念和各模块的用途。

---

## 目录结构概览

```
agent-framework/src/
├── types/                  # 核心类型定义
├── blueprint/              # 蓝图系统
├── components/             # 组件系统
│   ├── base/               # 基础组件
│   │   ├── error/          # 错误处理组件
│   │   ├── task-lifecycle/ # 任务生命周期组件
│   │   └── working-history/# 工作历史组件
│   └── builtin/            # 内置组件
│       ├── system/         # 系统组件
│       ├──          # 记忆组件
│       └── subagent/       # 子 Agent 组件
├── reducer/                # 归约器系统
│   └── reducers/           # 内置归约器
├── executor/               # 执行器
├── manager/                # 管理器
├── context/                # 上下文构建
├── compactor/              # 压缩器
├── storage/                # 存储层
│   └── postgres/           # PostgreSQL 实现
├── tools/                  # 工具系统
│   └── control-tools/      # 控制工具
├── debug/                  # 调试控制
├── llm/                    # LLM 适配器
├── tokenizer/              # 分词器
├── observer/               # 观察者
├── factories/              # 工厂函数
├── utils/                  # 工具函数
├── __mocks__/              # 测试 Mock
└── __tests__/              # 测试文件
```

---

## 核心概念

### 不可变状态 (Immutable State)

框架的核心原则是**状态不可变**。所有状态对象都被冻结（frozen），任何修改都会产生新的状态对象，而不是原地修改。

### 事件驱动架构

```
AgentEvent（事件）
    ↓
[ReducerRegistry]（归约器注册表）
    ↓
ReducerResult { operations[], chunks[] }
    ↓
[OperationExecutor]（操作执行器）
    ↓
New MemoryState（新的不可变状态）
```

### 记忆块 (Memory Chunk)

记忆块是记忆系统的原子单位，包含类型、内容、保留策略等属性。

### 组件 (Component)

组件是可插拔的功能模块，可以管理记忆块、提供工具、处理事件。

---

## `types/` - 核心类型定义

> 目录: `src/types/`

定义框架所有核心数据结构和类型。

### `chunk.types.ts` - 记忆块类型

定义记忆系统的原子单位。

**ChunkType 枚举** - 块类型：

| 类型              | 说明                   |
| ----------------- | ---------------------- |
| `SYSTEM`          | 系统指令               |
| `AGENT`           | Agent 配置             |
| `WORKFLOW`        | 工作流定义             |
| `DELEGATION`      | 委托信息               |
| `ENVIRONMENT`     | 环境信息               |
| `WORKING_HISTORY` | 工作历史               |
| `OUTPUT`          | 输出内容               |
| `COMPACTED`       | 压缩后的内容           |
| `USER_MESSAGE`    | 用户消息               |
| `THINKING`        | 思考过程               |
| `AGENT_RESPONSE`  | Agent 响应             |
| `AGENT_ACTION`    | Agent 动作（工具调用） |
| `ACTION_RESPONSE` | 动作响应               |
| `SUBAGENT_SPAWN`  | 子 Agent 创建          |
| `SUBAGENT_RESULT` | 子 Agent 结果          |
| `PARENT_MESSAGE`  | 父 Agent 消息          |

**ChunkRetentionStrategy 枚举** - 保留策略：

| 策略                 | 说明               |
| -------------------- | ------------------ |
| `CRITICAL`           | 关键内容，永不压缩 |
| `COMPRESSIBLE`       | 可独立压缩         |
| `BATCH_COMPRESSIBLE` | 可批量压缩         |
| `DISPOSABLE`         | 可丢弃             |
| `EPHEMERAL`          | 会话结束后丢弃     |

**MemoryChunk 接口**：

```typescript
interface MemoryChunk {
  id: string; // 唯一标识 (chunk_xxx)
  type: ChunkType; // 块类型
  content: ChunkContent; // 内容（文本/图片/混合）
  retentionStrategy: ChunkRetentionStrategy;
  mutable: boolean; // 是否可修改
  priority: number; // 排序优先级
  metadata: ChunkMetadata; // 元数据
  componentId?: string; // 所属组件 ID
  chunkKey?: string; // 组件内的块键
  childIds?: string[]; // 子块引用
}
```

### `state.types.ts` - 状态类型

**MemoryState 接口** - 不可变的记忆状态容器：

```typescript
interface MemoryState {
  id: string; // 状态标识 (state_xxx)
  chunkIds: readonly string[]; // 有序的块 ID 列表
  chunks: ReadonlyMap<string, MemoryChunk>; // 块映射表
  metadata: StateMetadata; // 状态元数据
  threadId?: string; // 所属线程
}
```

**StateProvenance** - 状态来源追踪：

- `eventId`, `eventType`: 触发状态变更的事件
- `source`: 变更来源（event_dispatch / compaction / truncation / manual / fork / initial）

### `operation.types.ts` - 操作类型

操作用于修改状态，每个操作都会生成新的不可变状态。

**OperationType 枚举**：

| 类型            | 说明                 |
| --------------- | -------------------- |
| `ADD`           | 添加块               |
| `UPDATE`        | 更新块               |
| `DELETE`        | 删除块               |
| `REORDER`       | 重排序               |
| `REPLACE`       | 替换单个块           |
| `BATCH_REPLACE` | 批量替换（用于压缩） |
| `BATCH`         | 批量操作容器         |

### `event.types.ts` - 事件类型

事件触发状态变更，共有 27+ 种事件类型。

**事件分类**：

| 分类     | 事件类型                                                                                          | 说明                       |
| -------- | ------------------------------------------------------------------------------------------------- | -------------------------- |
| 错误     | `TOOL_ERROR`, `SUBAGENT_ERROR`, `SKILL_ERROR`, `SYSTEM_ERROR`                                     | 各类错误事件               |
| 输入     | `USER_MESSAGE`, `PARENT_AGENT_MESSAGE`                                                            | 外部输入                   |
| LLM 响应 | `LLM_TEXT_RESPONSE`, `LLM_TOOL_CALL`, `LLM_SKILL_CALL`, `LLM_SUBAGENT_SPAWN`, `LLM_CLARIFICATION` | LLM 返回的各类响应         |
| 响应     | `TOOL_RESULT`, `SKILL_RESULT`, `SUBAGENT_RESULT`                                                  | 工具/技能/子Agent 执行结果 |
| 控制     | `TASK_COMPLETED`, `TASK_ABANDONED`, `TASK_TERMINATED`                                             | 任务生命周期               |
| 生命周期 | `EXECUTION_RETRY`, `EXECUTION_RESUME`, `EXECUTION_PAUSE`                                          | 执行控制                   |
| 组件     | `COMPONENT_ENABLE`, `COMPONENT_DISABLE`, `COMPONENT_DATA_UPDATE`                                  | 组件状态变更               |

**EventDispatchStrategy** - 事件分发策略：

- `queue`: 排队处理（默认）
- `interrupt`: 中断当前处理
- `terminate`: 终止执行
- `silent`: 静默处理

### `thread.types.ts` - 线程类型

**MemoryThread 接口**：

```typescript
interface MemoryThread {
  id: string; // 线程 ID
  agentId: string; // 关联的 Agent
  currentStateId: string; // 当前状态
  eventQueue: QueuedEvent[]; // 事件队列
  currentStepId?: string; // 当前步骤（步进模式）
  executionMode: 'auto' | 'stepping';
  status: AgentStatus; // Agent 状态
  metadata: ThreadMetadata;
}
```

**Step 接口** - 步骤记录：

```typescript
interface Step {
  triggerEvent: AgentEvent; // 触发事件
  llmInteraction?: LLMInteraction;
  status: 'running' | 'completed' | 'failed';
  previousStateId: string;
  resultStateId?: string;
  duration?: number;
}
```

### `agent.types.ts` - Agent 状态

**AgentStatus 枚举**：

| 状态               | 说明         |
| ------------------ | ------------ |
| `processing`       | 正在处理     |
| `waiting_internal` | 等待内部操作 |
| `awaiting_input`   | 等待用户输入 |
| `paused`           | 已暂停       |
| `completed`        | 已完成       |
| `error`            | 错误状态     |

---

## `blueprint/` - 蓝图系统

> 目录: `src/blueprint/`

蓝图定义了如何创建和配置 Agent。

### `blueprint.types.ts` - 蓝图类型定义

```typescript
interface Blueprint {
  id?: string; // 蓝图 ID
  name: string; // Agent 名称
  description?: string; // 描述
  components?: ComponentConfig[]; // 组件配置
  llmConfig: LLMConfig; // LLM 配置
  tools?: string[]; // 可用工具列表
  autoCompactThreshold?: number; // 自动压缩阈值
  executionMode?: 'auto' | 'stepping';
  subAgents?: Record<string, Blueprint>;
}
```

### `blueprint-loader.ts` - 蓝图加载器

**BlueprintLoader 类** - 核心方法：

| 方法                          | 说明                     |
| ----------------------------- | ------------------------ |
| `validate()`                  | 验证蓝图结构             |
| `load()`                      | 加载并应用配置覆盖       |
| `createThreadFromBlueprint()` | 从蓝图创建线程和初始状态 |
| `parseFromJSON()`             | 从 JSON 反序列化         |
| `toJSON()`                    | 序列化为 JSON            |

---

## `components/` - 组件系统

> 目录: `src/components/`

组件是框架的核心扩展机制，采用可插拔架构设计。

### `component.interface.ts` - 组件接口

**IComponent 接口**：

```typescript
interface IComponent {
  // 基本信息
  readonly id: string;
  readonly name: string;
  readonly type: ComponentBehaviorType; // 'base' | 'stable' | 'pluggable'

  // 生命周期钩子
  onInitialize?(): Promise<void>;
  onActivate?(): Promise<void>;
  onDeactivate?(): Promise<void>;
  onDestroy?(): Promise<void>;

  // 块管理
  getChunkConfigs?(): ChunkConfig[];
  createInitialChunks?(): Promise<MemoryChunk[]>;
  getOwnedChunkIds?(): string[];

  // 工具提供
  getTools?(): Tool[];

  // 事件处理
  getReducersForEvent?(eventType: EventType): EventReducer[];

  // 渲染
  renderChunk?(chunk: MemoryChunk): RenderedChunk;
}
```

**ComponentBehaviorType** - 组件行为类型：

| 类型        | 说明                          |
| ----------- | ----------------------------- |
| `base`      | 框架核心组件，始终启用        |
| `stable`    | 稳定组件，启用后不可禁用      |
| `pluggable` | 可插拔组件，可运行时启用/禁用 |

### `component-manager.ts` - 组件管理器

**ComponentManager 类** - 管理组件生命周期：

| 方法                       | 说明                 |
| -------------------------- | -------------------- |
| `register()`               | 注册组件             |
| `activate()`               | 激活组件             |
| `deactivate()`             | 停用组件             |
| `getActiveComponents()`    | 获取活动组件         |
| `getToolsFromComponents()` | 收集所有组件的工具   |
| `getReducersForEvent()`    | 获取事件对应的归约器 |

### `template-renderer.ts` - 模板渲染器

用于渲染组件的指令模板，支持变量替换和条件渲染。

---

## `components/base/` - 基础组件

> 目录: `src/components/base/`

框架核心组件，提供基础功能。

### `abstract-component.ts` - 抽象组件基类

提供组件的通用实现，简化自定义组件开发。

---

### `components/base/error/` - 错误处理组件

> 目录: `src/components/base/error/`

处理各类错误事件，生成错误相关的记忆块。

| 文件                  | 说明           |
| --------------------- | -------------- |
| `error.component.ts`  | 错误组件实现   |
| `error.operations.ts` | 错误相关操作   |
| `error.reducers.ts`   | 错误事件归约器 |
| `error.types.ts`      | 错误类型定义   |
| `index.ts`            | 导出入口       |

---

### `components/base/task-lifecycle/` - 任务生命周期组件

> 目录: `src/components/base/task-lifecycle/`

管理任务的完成、放弃、终止等状态。

| 文件                           | 说明               |
| ------------------------------ | ------------------ |
| `task-lifecycle.component.ts`  | 生命周期组件实现   |
| `task-lifecycle.operations.ts` | 生命周期操作       |
| `task-lifecycle.reducers.ts`   | 生命周期事件归约器 |
| `task-lifecycle.types.ts`      | 类型定义           |
| `index.ts`                     | 导出入口           |

---

### `components/base/working-history/` - 工作历史组件

> 目录: `src/components/base/working-history/`

管理对话历史记录，包括用户消息、Agent 响应、工具调用等。

| 文件                            | 说明           |
| ------------------------------- | -------------- |
| `working-history.component.ts`  | 历史组件实现   |
| `working-history.operations.ts` | 历史操作       |
| `working-history.reducers.ts`   | 历史事件归约器 |
| `working-history.types.ts`      | 类型定义       |
| `index.ts`                      | 导出入口       |

---

## `components/builtin/` - 内置组件

> 目录: `src/components/builtin/`

框架提供的开箱即用组件。

---

### `components/builtin/system/` - 系统组件

> 目录: `src/components/builtin/system/`

管理系统级指令和配置。

| 文件                   | 说明         |
| ---------------------- | ------------ |
| `system.component.ts`  | 系统组件实现 |
| `system.operations.ts` | 系统操作     |
| `system.types.ts`      | 系统类型定义 |
| `index.ts`             | 导出入口     |

---

### `components/builtin/todo/` - 待办事项组件

> 目录: `src/components/builtin/todo/`

提供待办列表管理功能。

| 文件                 | 说明            |
| -------------------- | --------------- |
| `todo.component.ts`  | Todo 组件实现   |
| `todo.helpers.ts`    | 辅助函数        |
| `todo.operations.ts` | Todo 操作       |
| `todo.reducers.ts`   | Todo 事件归约器 |
| `todo.types.ts`      | Todo 类型定义   |
| `index.ts`           | 导出入口        |

---

### `components/builtin/memory/` - 记忆组件

> 目录: `src/components/builtin/memory/`

提供记忆操作相关功能。

| 文件                  | 说明           |
| --------------------- | -------------- |
| `memory.component.ts` | 记忆组件实现   |
| `memory.reducers.ts`  | 记忆事件归约器 |
| `memory.types.ts`     | 记忆类型定义   |
| `index.ts`            | 导出入口       |

---

### `components/builtin/subagent/` - 子 Agent 组件

> 目录: `src/components/builtin/subagent/`

管理子 Agent 的状态和通信。

| 文件                     | 说明              |
| ------------------------ | ----------------- |
| `subagent.component.ts`  | 子 Agent 组件实现 |
| `subagent.operations.ts` | 子 Agent 操作     |
| `subagent.types.ts`      | 子 Agent 类型定义 |
| `index.ts`               | 导出入口          |

---

## `reducer/` - 归约器系统

> 目录: `src/reducer/`

归约器负责将事件转换为操作和记忆块。

### `reducer.interface.ts` - 归约器接口

```typescript
interface EventReducer {
  eventTypes: EventType[];
  canHandle(event: AgentEvent): boolean;
  reduce(state: MemoryState, event: AgentEvent): ReducerResult;
}

interface ReducerResult {
  operations: Operation[];
  chunks: MemoryChunk[];
}
```

### `reducer-registry.ts` - 归约器注册表

管理多个归约器，根据事件类型分发到对应的归约器。

---

### `reducer/reducers/` - 内置归约器

> 目录: `src/reducer/reducers/`

| 文件                      | 处理的事件                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `input.reducer.ts`        | `USER_MESSAGE`, `PARENT_AGENT_MESSAGE`                                                            |
| `llm-response.reducer.ts` | `LLM_TEXT_RESPONSE`, `LLM_TOOL_CALL`, `LLM_SKILL_CALL`, `LLM_SUBAGENT_SPAWN`, `LLM_CLARIFICATION` |
| `response.reducer.ts`     | `TOOL_RESULT`, `SKILL_RESULT`, `SUBAGENT_RESULT`                                                  |
| `control.reducer.ts`      | `TASK_COMPLETED`, `TASK_ABANDONED`, `TASK_TERMINATED` 及其他控制事件                              |
| `error.reducer.ts`        | `TOOL_ERROR`, `SUBAGENT_ERROR`, `SKILL_ERROR`, `SYSTEM_ERROR`                                     |

---

## `executor/` - 执行器

> 目录: `src/executor/`

执行操作和管理 LLM 调用。

### `operation.executor.ts` - 操作执行器

将操作应用到状态，生成新的不可变状态。

```typescript
function applyOperation(
  state: MemoryState,
  operation: Operation,
  pendingChunks: Map<string, MemoryChunk>
): ApplyResult {
  state: MemoryState
  addedChunks: MemoryChunk[]
  removedChunkIds: string[]
}
```

### `turn-executor.ts` - 轮次执行器

执行单次 LLM 调用：

1. 通过 ContextBuilder 构建上下文
2. 通过 LLMCaller 调用 LLM
3. 通过 ResponseParser 解析响应为事件

### `llm-loop-executor.ts` - LLM 循环执行器

编排多轮 LLM 调用：

- 可配置最大轮次和超时
- 支持取消令牌
- 工具调用处理器注入

### `llm-caller.ts` - LLM 调用器

封装 LLM API 调用，支持超时和取消。

### `response-parser.ts` - 响应解析器

解析 LLM 响应为 AgentEvent。

### `cancellation-token.ts` - 取消令牌

管理异步操作的取消。

---

## `manager/` - 管理器

> 目录: `src/manager/`

核心编排层，协调各模块工作。

### `memory.manager.ts` - 记忆管理器

**MemoryManager 类** - 框架主入口：

```typescript
const manager = new MemoryManager({
  storage: StorageProvider,
  reducerRegistry: ReducerRegistry,
  llmAdapter: ILLMAdapter,
  options: ManagerOptions,
});

// 核心方法
await manager.dispatch(threadId, event); // 分发事件
await manager.setExecutionMode(threadId, mode); // 设置执行模式
await manager.step(threadId); // 步进执行
```

### `thread.manager.ts` - 线程管理器

管理线程生命周期：

- 线程 CRUD 操作
- 内存状态缓存
- 事件队列管理
- 步进模式锁定

### `event-processor.ts` - 事件处理器

统一的事件处理逻辑：

- 支持自动/步进两种模式
- 执行归约器
- 检查自动压缩阈值
- 触发观察者通知

### `compaction.manager.ts` - 压缩管理器

管理记忆压缩：

- 基于 Token 的阈值（软阈值/硬阈值/截断阈值）
- 压缩器注册表
- 确定可压缩的块
- 执行压缩和截断

### `execution-mode-controller.ts` - 执行模式控制器

管理每个线程的执行模式：

- 跟踪待处理的压缩/截断
- 执行维护步骤

---

## `context/` - 上下文构建

> 目录: `src/context/`

将 MemoryState 转换为 LLM 可用的消息格式。

### `context-builder.ts` - 上下文构建器

```typescript
build(state: MemoryState, options: ContextBuildOptions): ContextBuildResult {
  messages: ContextMessage[]
  tokenCount: number
  includedChunkIds: string[]
}
```

### `chunk-renderers.ts` - 块渲染器

将不同类型的块渲染为 XML 标签格式：

| 块类型           | XML 标签               |
| ---------------- | ---------------------- |
| `SYSTEM`         | `<system_context>`     |
| `USER_MESSAGE`   | `<user_message>`       |
| `AGENT_RESPONSE` | `<assistant_response>` |
| `AGENT_ACTION`   | `<tool_call>`          |
| `THINKING`       | `<thinking>`           |

### `component-context-builder.ts` - 组件上下文构建器

收集各组件提供的上下文内容。

**渲染位置**：

- `system`: 系统提示词中
- `flow`: 对话流中

**排序值** (0-1000)：

- 0-100: 静态基础指令
- 100-300: 半静态文档
- 300-1000: 动态对话

---

## `compactor/` - 压缩器

> 目录: `src/compactor/`

通过 LLM 压缩记忆，减少 Token 使用。

### `compactor.interface.ts` - 压缩器接口

```typescript
interface ICompactor {
  chunkType: ChunkType;
  canCompact(chunks: MemoryChunk[]): boolean;
  compact(chunks: MemoryChunk[]): Promise<MemoryChunk>;
}
```

### `working-history.compactor.ts` - 工作历史压缩器

压缩对话/工作历史块：

- 使用 LLM 生成摘要
- 创建 `COMPACTED` 类型的块
- 通过 `BATCH_REPLACE` 操作替换多个块

---

## `storage/` - 存储层

> 目录: `src/storage/`

数据持久化层。

### `storage.interface.ts` - 存储接口

```typescript
interface StorageProvider {
  // 线程操作
  createThread(thread: MemoryThread): Promise<void>;
  getThread(threadId: string): Promise<MemoryThread | null>;
  updateThread(thread: MemoryThread): Promise<void>;
  deleteThread(threadId: string): Promise<void>;

  // 块操作
  saveChunks(chunks: MemoryChunk[]): Promise<void>;
  getChunks(chunkIds: string[]): Promise<MemoryChunk[]>;
  deleteChunks(chunkIds: string[]): Promise<void>;

  // 状态操作
  saveState(state: MemoryState): Promise<void>;
  getState(stateId: string): Promise<MemoryState | null>;
  getStateHistory(threadId: string): Promise<MemoryState[]>;

  // 步骤操作
  recordStep(step: Step): Promise<void>;

  // 事务支持
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
```

### `memory.storage.ts` - 内存存储

内存存储实现，用于测试和开发。

---

### `storage/postgres/` - PostgreSQL 存储

> 目录: `src/storage/postgres/`

### `postgres.storage.ts` - PostgreSQL 存储实现

生产环境使用的持久化存储。

---

## `tools/` - 工具系统

> 目录: `src/tools/`

Agent 可用的工具定义和注册。

### `tool.interface.ts` - 工具接口

```typescript
interface Tool {
  name: string;
  description: string;
  category: ToolCategory; // 'control' | 'common' | 'agent' | 'workflow'
  parameters: JSONSchema;
  execute(args: unknown, context: ToolContext): Promise<ToolResult>;
}
```

### `tool-registry.ts` - 工具注册表

```typescript
registry.register(tool: Tool)
registry.execute(name, args, context): Promise<ToolResult>
registry.getDefinitionsByNames(names): LLMToolDefinition[]
```

---

### `tools/control-tools/` - 控制工具

> 目录: `src/tools/control-tools/`

框架内置的控制工具：

| 工具                 | 说明           |
| -------------------- | -------------- |
| `wait_user_response` | 等待用户输入   |
| `output`             | 输出内容给用户 |
| `task_complete`      | 标记任务完成   |
| `task_abandon`       | 放弃任务       |
| `wait_parent`        | 等待父 Agent   |
| `invoke_tool`        | 调用外部工具   |

---

## `debug/` - 调试控制

> 目录: `src/debug/`

执行控制与调试功能。

### `debug-controller.ts` - 调试控制器

```typescript
interface DebugController {
  // 执行控制
  pause(): void;
  resume(): void;
  isPaused(): boolean;

  // 步进
  setExecutionMode(mode: 'auto' | 'stepping'): void;
  step(): Promise<StepResult>;
  getQueuedEventCount(): number;

  // 检查
  forkFromState(stateId: string): Promise<string>;
  createSnapshot(): Promise<Snapshot>;
  restoreSnapshot(snapshot: Snapshot): Promise<void>;

  // 状态编辑
  editChunk(chunkId: string, updates: Partial<MemoryChunk>): Promise<void>;
  injectEvent(event: AgentEvent): Promise<void>;
}
```

---

## `llm/` - LLM 适配器

> 目录: `src/llm/`

LLM 接口抽象层。

### `llm-adapter.interface.ts` - LLM 适配器接口

```typescript
interface ILLMAdapter {
  chat(messages: Message[], options: ChatOptions): Promise<ChatResponse>;
  streamChat(
    messages: Message[],
    options: ChatOptions,
  ): AsyncIterable<ChatChunk>;
}
```

---

## `tokenizer/` - 分词器

> 目录: `src/tokenizer/`

基于 `js-tiktoken` 实现，用于计算各模型的 Token 数量。

---

## `observer/` - 观察者

> 目录: `src/observer/`

提供事件通知机制，允许外部代码监听框架内部事件。

---

## `factories/` - 工厂函数

> 目录: `src/factories/`

创建各类对象的工厂函数。

| 文件                   | 说明                |
| ---------------------- | ------------------- |
| `chunk.factory.ts`     | 创建块，自动生成 ID |
| `state.factory.ts`     | 创建状态            |
| `thread.factory.ts`    | 创建线程            |
| `operation.factory.ts` | 创建操作            |

---

## `utils/` - 工具函数

> 目录: `src/utils/`

通用工具函数。

| 文件                     | 说明                               |
| ------------------------ | ---------------------------------- |
| `id.utils.ts`            | ID 生成（chunk_xxx, state_xxx 等） |
| `context-inheritance.ts` | 上下文数据继承                     |

---

## 执行模式

### 自动模式 (Auto Mode) - 默认

- 事件分发后立即处理
- 达到阈值时同步执行压缩

### 步进模式 (Stepping Mode) - 调试用

- 事件排入 `Thread.eventQueue`
- 通过 `step()` 方法逐个处理
- 步骤锁定防止并发执行
- 返回 `StepResult` 包含队列状态

**步进执行优先级**：

1. 从队列弹出并处理一个事件
2. 或执行待处理的截断
3. 或执行待处理的压缩

---

## 记忆管理策略

### Token 阈值

| 阈值     | Token 数 | 行为                               |
| -------- | -------- | ---------------------------------- |
| 软阈值   | 50K      | `suggestCompaction = true`         |
| 硬阈值   | 80K      | `forceCompaction = true`，立即触发 |
| 截断阈值 | 100K     | 移除最老的 `WORKING_FLOW` 块       |

### 块保留策略

| 策略                 | 行为                                   |
| -------------------- | -------------------------------------- |
| `CRITICAL`           | 永不压缩（SYSTEM, AGENT, WORKFLOW 等） |
| `COMPRESSIBLE`       | 可独立压缩                             |
| `BATCH_COMPRESSIBLE` | 可批量压缩                             |
| `DISPOSABLE`         | 可丢弃                                 |
| `EPHEMERAL`          | 会话结束后丢弃                         |

---

## 关键集成点

### 蓝图 → 记忆管理器

1. 加载蓝图并应用默认值
2. 创建初始线程和状态
3. 初始化组件
4. 将组件渲染为块和工具

### 事件 → 归约器 → 状态

1. 事件分发到 MemoryManager
2. ReducerRegistry 找到适用的归约器
3. 归约器生成操作和块
4. OperationExecutor 应用操作
5. 新状态持久化到存储

### 状态 → 上下文 → LLM

1. ContextBuilder 读取当前状态
2. 块渲染器将块格式化为 XML
3. 消息按角色和位置分组
4. 计算 Token 数量
5. 发送给 LLM 及工具定义

### LLM 响应 → 事件

1. ResponseParser 解析 LLM 响应
2. 创建 AgentEvent（LLM_TEXT_RESPONSE, LLM_TOOL_CALL 等）
3. 事件分发回系统
