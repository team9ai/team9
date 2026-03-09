# Tasks 模块 - 需求与设计文档

> 版本：1.0
> 日期：2026-02-23
> 状态：草稿
> 范围：Task List Tab + 后端 tasks 模块 + task-worker 服务 + 文档系统

---

## 1. 概述

Tasks 模块是 Team9 平台的 AI Staff（Bot）任务管理系统。用户可以为 Bot 创建一次性或周期性任务，Bot 自主执行任务并实时汇报进度，最终交付成果。用户可以监控执行过程、在需要时进行干预、查看交付物。

每个 Bot（目前底层由 OpenClaw 驱动）在 UI 中拥有一个「Task List」Tab，与 Messages 等 Tab 并列。此外，系统还提供一个独立的「Tasks」页面（与 AI Staff / Apps 同级），用于跨 Bot 统一管理和查看所有任务。

## 2. 核心概念

| 概念                           | 说明                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| **Task（任务）**               | 分配给某个 Bot 执行的工作单元，拥有完整的生命周期                                           |
| **Task Execution（执行记录）** | 任务的一次运行（版本）。周期性任务会生成多条执行记录                                        |
| **Task Entry（条目）**         | 执行过程中的时间线条目，包括步骤、人工干预、交付物等，统一存储于一张表                      |
| **Task Channel（任务频道）**   | 每次执行专属的虚拟 IM 频道（新增 `task` 频道类型），用于该次任务执行上下文中的用户-Bot 通信 |
| **Document（文档）**           | 附加在任务上的版本化 Markdown 文档，创建任务时自动创建，为 Agent 提供详细的任务说明         |

## 3. 任务生命周期

```
                    ┌─────────┐
                    │ upcoming │  （周期任务：等待调度 / 一次性任务：等待手动启动）
                    └────┬────┘
                         │ 触发 / 调度触发
                         ▼
                  ┌─────────────┐
           ┌──── │ in_progress  │ ◄──── 恢复（resume）
           │     └──┬───┬───┬──┘
           │        │   │   │
      需要人工输入   │   │   │ 暂停（pause）
           │        │   │   ▼
           ▼        │   │ ┌────────┐
   ┌──────────────┐ │   │ │ paused │ ── 恢复 ──→ in_progress
   │pending_action│ │   │ └────────┘
   └──────┬───────┘ │   │
          │ 用户响应  │   │ 停止 / 错误 / 超时
          └──► ──────┘   ▼
                    ┌──────────────┐
                    │ completed    │──→ 重新执行（restart）──→ 新执行记录
                    │ failed       │
                    │ stopped      │
                    │ timeout      │
                    └──────────────┘
```

### 状态枚举

| 状态             | 说明                             |
| ---------------- | -------------------------------- |
| `upcoming`       | 等待执行（已调度或等待手动触发） |
| `in_progress`    | Bot 正在执行中                   |
| `paused`         | 被用户暂停                       |
| `pending_action` | Bot 正在等待人工干预             |
| `completed`      | 执行成功完成                     |
| `failed`         | 执行出错结束                     |
| `stopped`        | 被用户手动终止                   |
| `timeout`        | 超出超时限制                     |

### 各状态下允许的用户操作

| 当前状态         | 允许的操作                 |
| ---------------- | -------------------------- |
| `upcoming`       | 启动、编辑、删除           |
| `in_progress`    | 停止、暂停、编辑（发消息） |
| `paused`         | 启动（恢复）、停止、编辑   |
| `pending_action` | 响应干预请求、停止         |
| `completed`      | 重新执行、查看交付物       |
| `failed`         | 重新执行、查看错误详情     |
| `stopped`        | 重新执行                   |
| `timeout`        | 重新执行                   |

## 4. 系统架构

```
                          ┌──────────────────┐
                          │   Client（UI）    │
                          │  Task List Tab    │
                          └────┬────────┬─────┘
                               │ REST   │ WebSocket (Socket.io)
                               ▼        ▼
                          ┌──────────────────┐
                          │     Gateway      │
                          │  tasks 模块      │
                          │  documents 模块  │
                          └────┬────────┬────┘
                     RabbitMQ  │        │ DB / Redis
                               ▼        ▼
┌──────────────┐      ┌──────────────┐   ┌──────────┐
│  task-worker │◄────►│  PostgreSQL  │   │  Redis   │
│  （新服务）    │      └──────────────┘   └──────────┘
└──────┬───────┘
       │ HTTP（OpenClaw API）
       ▼
┌──────────────┐
│   OpenClaw   │
│   实例        │
└──────────────┘
```

### 各组件职责

**Gateway（tasks 模块）**

- 提供任务 CRUD、控制、查询的 REST API
- 提供 Bot 侧 API，用于状态汇报、步骤更新、干预请求、交付物上传
- 通过 WebSocket 广播事件，实现 UI 实时更新
- 文档管理 API

**task-worker（新服务）**

- 周期任务调度器：扫描 `nextRunAt` 来触发执行
- 执行生命周期管理：创建执行记录、创建任务频道、触发 OpenClaw
- 超时检测：定期扫描超时的执行记录
- RabbitMQ 消费者：处理来自 Gateway 的命令（启动、暂停、停止等）

**OpenClaw 集成**

- Bot 类型为 `openclaw` → 将执行委托给 OpenClaw Agent
- Agent 通过 Bot API（access token 认证）汇报进度
- 未来：其他 Bot 类型可实现不同的执行策略

## 5. 数据模型

### 5.1 `agent_task__tasks` - 任务主表

```sql
CREATE TABLE agent_task__tasks (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    bot_id          UUID NOT NULL REFERENCES im_bots(id) ON DELETE CASCADE,
    creator_id      UUID NOT NULL REFERENCES im_users(id),
    title           VARCHAR(500) NOT NULL,
    description     TEXT,                          -- 简要描述（与文档分开）
    status          agent_task__status NOT NULL DEFAULT 'upcoming',
    schedule_type   agent_task__schedule_type NOT NULL DEFAULT 'once',  -- 'once' | 'recurring'
    schedule_config JSONB,                         -- { frequency: 'daily', time: '09:00', timezone: 'Asia/Shanghai' } 或 cron
    next_run_at     TIMESTAMP,                     -- 下次计划执行时间（供 task-worker 扫描）
    document_id     UUID REFERENCES documents(id), -- 关联的任务文档（创建任务时自动创建）
    current_execution_id UUID,                     -- 指向当前/最新执行记录（反范式化，加速查询）
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_agent_task__tasks_tenant_id ON agent_task__tasks(tenant_id);
CREATE INDEX idx_agent_task__tasks_bot_id ON agent_task__tasks(bot_id);
CREATE INDEX idx_agent_task__tasks_creator_id ON agent_task__tasks(creator_id);
CREATE INDEX idx_agent_task__tasks_status ON agent_task__tasks(status);
CREATE INDEX idx_agent_task__tasks_next_run_at ON agent_task__tasks(next_run_at);
CREATE INDEX idx_agent_task__tasks_tenant_status ON agent_task__tasks(tenant_id, status);
```

**枚举类型：**

```sql
CREATE TYPE agent_task__status AS ENUM (
    'upcoming', 'in_progress', 'paused', 'pending_action',
    'completed', 'failed', 'stopped', 'timeout'
);

CREATE TYPE agent_task__schedule_type AS ENUM ('once', 'recurring');
```

### 5.2 `agent_task__executions` - 执行记录（版本）

每次触发（手动或调度）会创建一条执行记录，并关联一个专属任务频道。

```sql
CREATE TABLE agent_task__executions (
    id              UUID PRIMARY KEY,
    task_id         UUID NOT NULL REFERENCES agent_task__tasks(id) ON DELETE CASCADE,
    version         INTEGER NOT NULL,              -- 执行版本号（1, 2, 3...）
    status          agent_task__status NOT NULL DEFAULT 'in_progress',
    channel_id      UUID REFERENCES im_channels(id), -- 本次执行的专属虚拟频道
    token_usage     INTEGER NOT NULL DEFAULT 0,
    started_at      TIMESTAMP,
    completed_at    TIMESTAMP,
    duration        INTEGER,                       -- 秒
    error           JSONB,                         -- 失败时的错误详情
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_task__executions_task_id ON agent_task__executions(task_id);
CREATE INDEX idx_agent_task__executions_status ON agent_task__executions(status);
CREATE INDEX idx_agent_task__executions_task_version ON agent_task__executions(task_id, version);
```

### 5.3 `agent_task__steps` - 执行步骤

```sql
CREATE TABLE agent_task__steps (
    id              UUID PRIMARY KEY,
    execution_id    UUID NOT NULL REFERENCES agent_task__executions(id) ON DELETE CASCADE,
    task_id         UUID NOT NULL REFERENCES agent_task__tasks(id) ON DELETE CASCADE,  -- 反范式化
    order_index     INTEGER NOT NULL,
    title           VARCHAR(500) NOT NULL,
    status          agent_task__step_status NOT NULL DEFAULT 'pending',
    token_usage     INTEGER NOT NULL DEFAULT 0,
    duration        INTEGER,                       -- 秒
    started_at      TIMESTAMP,
    completed_at    TIMESTAMP,
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TYPE agent_task__step_status AS ENUM ('pending', 'in_progress', 'completed', 'failed');

CREATE INDEX idx_agent_task__steps_execution_id ON agent_task__steps(execution_id);
CREATE INDEX idx_agent_task__steps_task_id ON agent_task__steps(task_id);
```

### 5.4 `agent_task__deliverables` - 交付物

```sql
CREATE TABLE agent_task__deliverables (
    id              UUID PRIMARY KEY,
    execution_id    UUID NOT NULL REFERENCES agent_task__executions(id) ON DELETE CASCADE,
    task_id         UUID NOT NULL REFERENCES agent_task__tasks(id) ON DELETE CASCADE,  -- 反范式化
    file_name       VARCHAR(500) NOT NULL,
    file_size       BIGINT,                        -- 字节
    mime_type       VARCHAR(128),
    file_url        TEXT NOT NULL,                  -- 存储 URL
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_task__deliverables_execution_id ON agent_task__deliverables(execution_id);
CREATE INDEX idx_agent_task__deliverables_task_id ON agent_task__deliverables(task_id);
```

### 5.5 `agent_task__interventions` - 人工干预请求

```sql
CREATE TABLE agent_task__interventions (
    id              UUID PRIMARY KEY,
    execution_id    UUID NOT NULL REFERENCES agent_task__executions(id) ON DELETE CASCADE,
    task_id         UUID NOT NULL REFERENCES agent_task__tasks(id) ON DELETE CASCADE,  -- 反范式化
    step_id         UUID REFERENCES agent_task__steps(id),
    prompt          TEXT NOT NULL,                  -- 向用户展示的提示信息
    actions         JSONB NOT NULL,                 -- [{ label: string, value: string }]
    response        JSONB,                          -- 用户的回应 { action: string, message?: string }
    status          agent_task__intervention_status NOT NULL DEFAULT 'pending',
    resolved_by     UUID REFERENCES im_users(id),
    resolved_at     TIMESTAMP,
    expires_at      TIMESTAMP,                     -- 可选过期时间
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TYPE agent_task__intervention_status AS ENUM ('pending', 'resolved', 'expired');

CREATE INDEX idx_agent_task__interventions_execution_id ON agent_task__interventions(execution_id);
CREATE INDEX idx_agent_task__interventions_task_id ON agent_task__interventions(task_id);
CREATE INDEX idx_agent_task__interventions_status ON agent_task__interventions(status);
```

### 5.6 文档系统（`schemas/document/`）

独立的文档系统，支持完整的版本历史。

**`documents` - 文档主表**

```sql
CREATE TABLE documents (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    owner_type          VARCHAR(64) NOT NULL,          -- 'task' | 'bot' | ...（可扩展）
    owner_id            UUID NOT NULL,                  -- 多态外键
    title               VARCHAR(500),
    current_version_id  UUID,                           -- 指向最新版本（反范式化）
    created_by          UUID NOT NULL REFERENCES im_users(id),
    created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_tenant_id ON documents(tenant_id);
CREATE INDEX idx_documents_owner ON documents(owner_type, owner_id);
```

**`document_versions` - 版本历史表**

```sql
CREATE TABLE document_versions (
    id              UUID PRIMARY KEY,
    document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version         INTEGER NOT NULL,              -- 按文档自增的版本号
    content         TEXT NOT NULL,                  -- Markdown 内容
    summary         TEXT,                          -- 变更摘要（可选）
    updated_by      UUID NOT NULL REFERENCES im_users(id),
    created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_document_versions_document_id ON document_versions(document_id);
CREATE UNIQUE INDEX idx_document_versions_doc_version ON document_versions(document_id, version);
```

### 5.7 频道类型扩展

扩展 `im_channels.channel_type` 枚举：

```sql
ALTER TYPE channel_type ADD VALUE 'task';
```

任务频道特性：

- 每次执行自动创建，用户不可手动创建
- 成员：任务创建者 + 被分配的 Bot
- 在频道列表侧边栏中隐藏（通过 type != 'task' 过滤）
- 仅通过任务详情面板访问

## 6. API 设计

### 6.1 任务 CRUD（面向用户，JWT 认证）

```
POST   /v1/tasks                          创建任务
GET    /v1/tasks                          查询任务列表（参数：botId, tenantId, status, scheduleType）
GET    /v1/tasks/:id                      获取任务详情（包含当前执行记录、步骤、干预请求）
PATCH  /v1/tasks/:id                      更新任务（标题、描述、调度配置）
DELETE /v1/tasks/:id                      删除任务
```

### 6.2 任务控制（面向用户，JWT 认证）

```
POST   /v1/tasks/:id/start               启动 / 触发任务
POST   /v1/tasks/:id/pause               暂停任务
POST   /v1/tasks/:id/resume              恢复任务
POST   /v1/tasks/:id/stop                停止任务
POST   /v1/tasks/:id/restart             重新执行（创建新的执行记录）
```

### 6.3 执行记录与步骤（面向用户，JWT 认证）

```
GET    /v1/tasks/:id/executions           获取任务的所有执行记录
GET    /v1/tasks/:id/executions/:execId   获取某次执行详情（包含步骤）
GET    /v1/tasks/:id/executions/:execId/steps   获取某次执行的步骤列表
```

### 6.4 人工干预（面向用户，JWT 认证）

```
GET    /v1/tasks/:id/interventions        获取待处理的干预请求列表
POST   /v1/tasks/:id/interventions/:intId/resolve   响应干预请求
```

### 6.5 交付物（面向用户，JWT 认证）

```
GET    /v1/tasks/:id/deliverables         获取交付物列表（可按 executionId 筛选）
```

### 6.6 文档（面向用户，JWT 认证）

```
GET    /v1/documents/:id                  获取文档（最新版本）
PUT    /v1/documents/:id                  更新文档（自动创建新版本）
GET    /v1/documents/:id/versions         获取版本历史列表
GET    /v1/documents/:id/versions/:ver    获取指定版本内容
```

### 6.7 Bot API（Bot Access Token 认证）

这些接口由 Bot（OpenClaw Agent）调用，用于汇报执行进度。

```
GET    /v1/bot/tasks/pending              获取分配给该 Bot 的待执行任务
GET    /v1/bot/tasks/:id                  获取任务详情 + 文档
PATCH  /v1/bot/tasks/:id/status           更新执行状态
POST   /v1/bot/tasks/:id/steps            汇报步骤进度（创建/更新步骤）
POST   /v1/bot/tasks/:id/interventions    发起人工干预请求
POST   /v1/bot/tasks/:id/deliverables     上传交付物文件
GET    /v1/bot/tasks/:id/document         获取任务文档（供 Agent 阅读任务说明）
```

**Bot 步骤汇报载荷：**

```json
{
  "steps": [
    {
      "orderIndex": 1,
      "title": "清洗并分析竞品用户评论中的核心需求痛点",
      "status": "completed",
      "tokenUsage": 248,
      "duration": 72
    },
    {
      "orderIndex": 2,
      "title": "自动汇总多份市场报告并提取核心观点",
      "status": "in_progress"
    }
  ]
}
```

**Bot 干预请求载荷：**

```json
{
  "prompt": "是否允许我们访问您的服务器配置？",
  "actions": [
    { "label": "允许", "value": "allow" },
    { "label": "拒绝", "value": "deny" }
  ]
}
```

## 7. WebSocket 事件

所有事件的作用域为 tenant 房间（复用现有模式）。

| 事件                          | 方向            | 载荷                                                   |
| ----------------------------- | --------------- | ------------------------------------------------------ |
| `task:status_changed`         | 服务端 → 客户端 | `{ taskId, executionId, status, previousStatus }`      |
| `task:step_updated`           | 服务端 → 客户端 | `{ taskId, executionId, steps: [...] }`                |
| `task:intervention_requested` | 服务端 → 客户端 | `{ taskId, executionId, intervention: {...} }`         |
| `task:intervention_resolved`  | 服务端 → 客户端 | `{ taskId, executionId, interventionId, response }`    |
| `task:deliverable_added`      | 服务端 → 客户端 | `{ taskId, executionId, deliverable: {...} }`          |
| `task:token_usage_updated`    | 服务端 → 客户端 | `{ taskId, executionId, tokenUsage, stepTokenUsage? }` |
| `task:execution_created`      | 服务端 → 客户端 | `{ taskId, execution: {...} }`                         |

## 8. task-worker 服务

### 8.1 目录结构

```
apps/server/apps/task-worker/
├── src/
│   ├── main.ts                          -- 服务入口（端口 3002）
│   ├── app.module.ts                    -- 根模块
│   ├── scheduler/
│   │   ├── scheduler.module.ts
│   │   └── scheduler.service.ts         -- 基于定时的周期任务触发器
│   ├── executor/
│   │   ├── executor.module.ts
│   │   ├── executor.service.ts          -- 执行生命周期管理
│   │   └── strategies/
│   │       ├── execution-strategy.interface.ts  -- 抽象执行接口
│   │       └── openclaw.strategy.ts     -- OpenClaw 特定执行策略
│   ├── timeout/
│   │   ├── timeout.module.ts
│   │   └── timeout.service.ts           -- 超时检测
│   └── consumer/
│       ├── consumer.module.ts
│       └── task-command.consumer.ts     -- RabbitMQ：处理 启动/暂停/停止/恢复 命令
```

### 8.2 调度器逻辑

```
每 30 秒执行一次：
  1. SELECT * FROM agent_task__tasks
     WHERE schedule_type = 'recurring'
       AND next_run_at <= NOW()
       AND status NOT IN ('stopped', 'paused')
  2. 对每个命中的任务：
     a. 创建 agent_task__execution 记录（version = max(version) + 1）
     b. 创建任务频道（im_channels type='task'，成员 = [创建者, Bot]）
     c. 通过 OpenClaw API 触发 Agent 执行
     d. 更新任务：status = 'in_progress', current_execution_id, next_run_at = 计算下次执行时间(scheduleConfig)
```

### 8.3 超时检测

```
每 60 秒执行一次：
  1. SELECT * FROM agent_task__executions
     WHERE status = 'in_progress'
       AND started_at + interval '24 hours' < NOW()   -- 可按任务配置
  2. 对每个超时的执行记录：
     a. 更新执行记录：status = 'timeout'
     b. 更新父任务：status = 'timeout'
     c. 发出 WebSocket 事件：task:status_changed
     d. 通知 OpenClaw 停止 Agent（如适用）
```

### 8.4 执行流程

```
触发（手动或调度）
  │
  ├─ 1. 创建 agent_task__execution 记录
  ├─ 2. 创建任务频道（im_channels type='task'）
  ├─ 3. 将成员加入频道（创建者 + Bot）
  ├─ 4. 更新 task.status = 'in_progress', task.current_execution_id
  ├─ 5. 调用 OpenClaw API 启动 Agent
  │     POST {openclaw_url}/api/agents/{agentId}/execute
  │     Body: { taskId, executionId, documentContent, channelId }
  └─ 6. 发出 WebSocket 事件：task:status_changed, task:execution_created

Agent 执行中...
  │
  ├─ Agent 调用：PATCH /v1/bot/tasks/:id/status → 更新进度
  ├─ Agent 调用：POST /v1/bot/tasks/:id/steps → 汇报步骤完成情况
  ├─ Agent 调用：POST /v1/bot/tasks/:id/interventions → 需要人工输入
  │     → 任务状态 → pending_action
  │     → WebSocket：task:intervention_requested
  │     → 用户响应 → POST /v1/tasks/:id/interventions/:intId/resolve
  │     → 任务状态 → in_progress（Agent 继续执行）
  ├─ Agent 调用：POST /v1/bot/tasks/:id/deliverables → 上传文件
  └─ Agent 调用：PATCH /v1/bot/tasks/:id/status { status: 'completed' }
       → WebSocket：task:status_changed
```

## 9. 前端设计（基于设计稿）

### 9.1 入口

有两个入口：

1. **Bot 详情页 Tab**：Task List 是 Bot 详情页内的一个新 Tab，与 Messages 并列。仅显示该 Bot 的任务。
   - 路由：`/workspace/:tenantId/bot/:botId/tasks`（或作为 Bot 详情内的 Tab 渲染）

2. **独立 Tasks 页面**：与 AI Staff / Apps 同级的顶层页面，跨 Bot 展示和管理所有任务。支持按 Bot 筛选。
   - 路由：`/workspace/:tenantId/tasks`

### 9.2 任务列表视图

**筛选 Tab：**

- **In progress**（数量）— 显示状态为 `in_progress`、`paused`、`pending_action` 的任务
- **Upcoming**（数量）— 显示状态为 `upcoming` 的任务
- **Finished**（数量）— 显示状态为 `completed`、`failed`、`stopped`、`timeout` 的任务

**任务卡片（进行中）：**

```
◎ [加载动画] 任务标题
  开始时间：2026-01-18 17:54 · 2m 17s · 已用 248 Tokens
  ↳ 当前步骤摘要文本                                    [⊘ 停止] [⊙ 暂停] [✎ 编辑]
```

- `pending_action` 状态的任务显示「待处理操作」徽章
- `paused` 状态的任务在当前步骤上显示「已暂停」徽章

**任务卡片（待执行）：**

```
◎ 任务标题
  [每天]  预计开始：2026-01-18 17:54
```

- 周期性任务显示调度频率徽章（每天、每周 等）

**任务卡片（已完成）：**

```
● 任务标题
  开始：2026-01-18 17:54 · 结束：2026-01-18 17:54 · 2m 17s · 已用 248 Tokens
  📁 交付 3 个文件                                              [↻ 重新执行]
```

- 如果周期任务的下一次计划执行正在进行中，显示「计划任务：◎ 执行中」

### 9.3 任务详情面板（右侧抽屉）

点击任务卡片展开。响应式布局：

- 宽屏：与任务列表并排显示
- 窄屏：覆盖式面板

**头部：**

```
✕ 关闭
📋 分析 2025 年企业级 AI 工具市场规模与增长趋势
◎ 执行中 · 2m 17s · 已用 496 Tokens
```

**任务步骤（时间线）：**

```
──── 任务步骤 ────
✅ 清洗并分析竞品用户评论中的核心需求痛点
   2026-01-18 17:54 · 1m 12s · 已用 248 Tokens
✅ 自动汇总多份市场报告并提取核心观点
   2026-01-18 17:54 · 1m 5s · 已用 248 Tokens
◎  研究行业政策变化的影响
   （执行中...）
```

**暂停状态：**

```
ℹ️ 任务执行已暂停。
   [⊙ 启动]
```

**人工干预（pending_action）：**

```
◎  研究行业政策变化的影响
   ⚠️ 是否允许我们访问您的服务器配置？
   [操作：允许] [操作：拒绝]
```

**已完成 - 交付物：**

```
──── 交付 3 个文件 ────
🖼️ xnip2025-07-30.png    1.16MB
📄 hello.docx             1.16MB
📊 hello.pptx             1.16MB
```

**消息输入框（底部）：**

```
┌─────────────────────────────────────────┐
│ B I ≡ ≡                                │
│ 发送消息以调整任务                        │
│ Aa 😊 @ 📎 ↗                        🔵 │
└─────────────────────────────────────────┘
```

消息发送到该次执行的专属频道（im_channels type='task'）。

## 10. 调度配置

### 10.1 scheduleConfig 结构

```typescript
interface ScheduleConfig {
  // 简单预设
  frequency?: "daily" | "weekly" | "monthly";
  time?: string; // "09:00"（HH:mm）
  timezone?: string; // "Asia/Shanghai"
  dayOfWeek?: number; // 0-6（用于每周）
  dayOfMonth?: number; // 1-31（用于每月）

  // 高级：原始 cron 表达式（优先级高于上述配置）
  cron?: string; // "0 9 * * *"
}
```

### 10.2 next_run_at 计算

当周期任务创建或某次执行完成时，根据 `scheduleConfig` 重新计算 `next_run_at`。task-worker 通过扫描 `next_run_at <= NOW()` 来触发执行。

## 11. 与现有系统的关系

| 现有组件           | 关系                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `tracker_tasks` 表 | 现有通用任务追踪器。Tasks 模块使用**独立的表**（`agent_task__*`），因为语义不同。`tracker_tasks` 继续用于其他内部追踪。 |
| `im_bots`          | 任务执行者，通过 `agent_task__tasks.bot_id` 关联                                                                        |
| `im_channels`      | 扩展 `task` 频道类型，用于每次执行的专属通信                                                                            |
| `im_users`         | 任务创建者，通过 `agent_task__tasks.creator_id` 关联                                                                    |
| `im-worker`        | 不变。任务调度由新的 `task-worker` 服务处理                                                                             |
| WebSocket Gateway  | 复用现有 Socket.io 基础设施，新增 `task:*` 事件                                                                         |
| 文件模块 / 存储    | 交付物文件通过现有存储基础设施保存                                                                                      |
| OpenClaw 模块      | `task-worker` 调用 OpenClaw API 触发 Agent 执行                                                                         |
| Bot Access Token   | Bot API 接口通过现有 `t9bot_` Token 机制认证                                                                            |

## 12. Gateway 模块结构

```
apps/server/apps/gateway/src/
├── tasks/
│   ├── tasks.module.ts
│   ├── tasks.controller.ts            -- 面向用户的任务 CRUD 与控制
│   ├── tasks.service.ts               -- 任务业务逻辑
│   ├── task-bot.controller.ts         -- 面向 Bot 的 API（access token 认证）
│   ├── task-bot.service.ts            -- Bot API 业务逻辑
│   ├── task-execution.service.ts      -- 执行管理
│   ├── task-intervention.service.ts   -- 干预管理
│   ├── task-deliverable.service.ts    -- 交付物管理
│   └── dto/
│       ├── create-task.dto.ts
│       ├── update-task.dto.ts
│       ├── task-control.dto.ts
│       ├── report-steps.dto.ts
│       ├── create-intervention.dto.ts
│       └── resolve-intervention.dto.ts
├── documents/
│   ├── documents.module.ts
│   ├── documents.controller.ts
│   └── documents.service.ts
```

## 13. 数据库 Schema 结构

```
apps/server/libs/database/src/schemas/
├── im/          （现有）
├── tenant/      （现有）
├── tracker/     （现有）
├── task/        （新增）
│   ├── index.ts
│   ├── tasks.ts
│   ├── task-executions.ts
│   ├── task-steps.ts
│   ├── task-deliverables.ts
│   ├── task-interventions.ts
│   └── relations.ts
└── document/    （新增）
    ├── index.ts
    ├── documents.ts
    ├── document-versions.ts
    └── relations.ts
```

## 14. 实施阶段（建议）

### 第一阶段：基础搭建

- [ ] 数据库 Schema（task/, document/）
- [ ] 文档模块（CRUD + 版本管理）
- [ ] 任务 CRUD API（Gateway）
- [ ] 基础任务列表 UI（Task List Tab，卡片展示）

### 第二阶段：执行引擎

- [ ] task-worker 服务脚手架
- [ ] 执行生命周期（创建执行记录、创建任务频道）
- [ ] OpenClaw 执行策略集成
- [ ] Bot API 接口（状态汇报、步骤更新）
- [ ] WebSocket 实时更新事件

### 第三阶段：交互功能

- [ ] 任务控制（启动、暂停、恢复、停止、重新执行）
- [ ] 干预系统（发起请求 + 用户响应）
- [ ] 任务详情面板 UI（步骤时间线、干预交互）
- [ ] 详情面板消息输入框（任务频道集成）

### 第四阶段：调度与交付物

- [ ] task-worker 中的周期任务调度器
- [ ] 调度配置 UI
- [ ] 交付物上传与展示
- [ ] 已完成任务视图（含交付物列表）

### 第五阶段：完善

- [ ] 超时检测
- [ ] 错误处理与重试
- [ ] Token 用量统计与展示
- [ ] 文档版本历史 UI
