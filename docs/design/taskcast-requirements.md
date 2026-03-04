# TaskCast 需求文档 — Team9 Task Module 集成

> 来自：Team9 项目
> 日期：2026-03-03
> 状态：草稿

---

## 背景

Team9 是一个 IM + AI Staff 协作平台。我们正在构建 Task Module，让用户给 AI Bot 分配任务，Bot 自主执行并实时汇报进度。

我们希望使用 TaskCast 作为任务执行的实时事件流层。前端直接通过 TaskCast SSE 订阅任务更新，与现有 IM 的 Socket.io 通道独立，职责分离。

### 我们的任务模型

```
Task（业务实体，持久化）
 └── Execution（一次执行，可多次，每次对应一个 TaskCast Task）
      ├── Steps（有序步骤，每步有独立状态）
      ├── Interventions（人工干预请求）
      └── Deliverables（交付物）
```

### 当前集成方案

- 每次 Task Execution 创建时，同时创建一个 TaskCast Task
- Bot 执行过程中的进度更新通过 `@taskcast/server-sdk` publish 为 events
- 前端通过 `@taskcast/react` 订阅实时更新
- 业务状态（upcoming, paused, pending_action 等）仍由 Team9 自己管理

---

## 需求 1：自定义状态扩展

### 问题

TaskCast 当前状态机：`pending → running → completed | failed | timeout | cancelled`

Team9 需要额外的执行状态：

| 状态      | 语义             | 场景                                         |
| --------- | ---------------- | -------------------------------------------- |
| `paused`  | 用户主动暂停执行 | 用户点击"暂停"，Bot 停止工作，稍后恢复       |
| `blocked` | 等待外部输入     | Bot 遇到需要人工决策的节点，暂停执行等待响应 |

### 期望方案

**方案 A：内置 `paused` 和 `blocked` 状态**

```
pending → running → completed | failed | timeout | cancelled
              ↕
           paused    （用户控制）
              ↕
           blocked   （系统/Agent 触发，等待外部输入）
```

合法转换：

- `running ↔ paused`
- `running → blocked → running`（blocked 被 resolve 后恢复）
- `paused → cancelled`（暂停状态下可取消）

**方案 B：可配置状态机**

创建 Task 时允许声明额外状态和转换规则：

```typescript
await client.createTask({
  type: "agent.execution",
  stateMachine: {
    customStates: ["paused", "blocked"],
    transitions: {
      running: ["paused", "blocked", "completed", "failed", "cancelled"],
      paused: ["running", "cancelled"],
      blocked: ["running", "cancelled"],
    },
  },
});
```

### 优先级：高

没有 paused/blocked 状态，我们只能在 TaskCast 之外单独管理，导致状态不一致。

---

## 集成架构总览

```
┌─────────────┐
│  Client UI  │
└──┬──────┬───┘
   │      │
   │ REST │ SSE（直连 TaskCast）
   │      │
   ▼      ▼
┌──────┐  ┌──────────────┐
│  GW  │  │   TaskCast   │
│tasks │  │   Service    │
└──┬───┘  └──────┬───────┘
   │ RabbitMQ    │ Redis
   ▼             │
┌──────────┐     │
│task-worker│─────┘ server-sdk (publish events)
└──────────┘
```

**职责分离：**

- **Socket.io**：IM 消息、频道事件、用户在线状态（已有）
- **TaskCast SSE**：任务执行进度、步骤更新、状态变更（新增）
- **Gateway REST**：任务 CRUD、控制操作、干预响应

**写入路径**：task-worker / Gateway → TaskCast server-sdk → publish events
**读取路径**：Client → TaskCast SSE → 实时订阅执行进度

---

## 总结

本文档仅包含一个需求：**自定义状态扩展（paused/blocked）**。

其余场景（步骤追踪、metadata 更新、任务分组）均可通过 TaskCast 现有的 `seriesMode: 'latest'` 事件能力 + 业务层管理解决，不需要 TaskCast 新增功能。
