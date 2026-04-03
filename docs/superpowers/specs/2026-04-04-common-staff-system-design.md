# Common Staff System Design

> Date: 2026-04-04
> Status: Draft
> Author: Winrey + Claude

## Overview

为 Team9 接入正式的 AI 员工系统，对应 agent-hive 的 `team9-common-staff` blueprint。该应用是自动安装、不可卸载的 managed 单例组件。与现有 `base-model-staff`（基础模型直通）共存，`common-staff` 是有完整身份、角色、persona 的"正式员工"。

## 与现有系统的关系

| 特性           | base-model-staff                 | common-staff (本设计)               |
| -------------- | -------------------------------- | ----------------------------------- |
| 类型           | singleton, autoInstall, custom   | singleton, autoInstall, **managed** |
| 安装时创建 bot | 3 个固定 (Claude/ChatGPT/Gemini) | 0 个                                |
| 用户可卸载     | 是 (type=custom)                 | **否** (type=managed)               |
| Bot 可删除     | 否                               | **是**                              |
| Blueprint      | `team9-hive-base-model`          | `team9-common-staff`                |
| Profile 管理   | 无                               | 有 (name/role/persona)              |
| Mentor 系统    | 隐式 (installer)                 | 显式 (可选任意成员)                 |
| Model 选择     | 固定 per bot                     | 用户选择，默认 Claude Sonnet 4.6    |
| Bootstrap 流程 | 无                               | 支持 mentor DM 引导                 |

## 1. Application 定义

在 `APPLICATIONS` 数组中新增：

```typescript
{
  id: 'common-staff',
  name: 'Common Staff',
  description: 'AI employee system with profile, role, and mentor bootstrap',
  iconUrl: '/icons/common-staff.svg',
  categories: ['ai', 'bot'],
  enabled: true,
  type: 'managed',        // 不可卸载、不可禁用
  singleton: true,         // 每个 workspace 只有一个
  autoInstall: true,       // workspace 创建时自动安装
}
```

### CommonStaffHandler

- `applicationId: 'common-staff'`
- `onInstall()`: 空操作 — 不创建任何 bot，返回空 config
- 卸载保护由 `type: 'managed'` 在 service 层自动处理（`ForbiddenException`）

## 2. Backend API — Staff CRUD

所有端点在 `InstalledApplicationsController` 下，需 `JwtAuthGuard` 鉴权 + workspace 成员验证。

### 创建员工

```
POST /v1/installed-applications/:id/common-staff/staff
Body: {
  displayName: string          // 必填
  roleTitle?: string           // 可选（agentic 模式留空，UI 表单式必填由前端校验）
  mentorId?: string            // 可选，服务端默认 currentUser
  persona?: string             // 可选
  jobDescription?: string      // 可选，岗位描述
  model: {                     // 必填，默认 { provider: "anthropic", id: "claude-sonnet-4-6" }
    provider: string
    id: string
  }
  avatarUrl?: string           // 可选
  agenticBootstrap?: boolean   // true = 走 agentic 创建路径
}
Response: { botId, userId, agentId, displayName }
```

**流程：**

1. 验证 app 是 `common-staff` 类型
2. `createWorkspaceBot()` 创建 bot（含 access token）
3. `clawHiveService.registerAgent()` 注册到 claw-hive
4. 为所有 workspace 成员创建 DM channel
5. 若 `agenticBootstrap === true`：触发 bootstrap 事件（见 Section 7）
6. 返回 bot 信息

### 更新员工

```
PATCH /v1/installed-applications/:id/common-staff/staff/:botId
Body: {
  displayName?: string
  roleTitle?: string
  persona?: string
  jobDescription?: string
  model?: { provider: string; id: string }
  avatarUrl?: string
  mentorId?: string
}
```

同步更新 team9 bot + `clawHiveService.updateAgent()` 更新 claw-hive 侧。

### 删除员工

```
DELETE /v1/installed-applications/:id/common-staff/staff/:botId
```

1. `clawHiveService.deleteAgent()` 注销 claw-hive agent
2. `botService.deleteBotAndCleanup()` 删除 bot + DM channel

### 列表查询

复用 `GET /v1/installed-applications/with-bots`，在返回数据中包含 common-staff 类型 bot。

## 3. Backend API — Persona 流式生成

```
POST /v1/installed-applications/:id/common-staff/generate-persona
Body: {
  displayName?: string
  roleTitle?: string
  existingPersona?: string    // 已有 persona，基于此扩充
  prompt?: string              // 用户自由指令，如"要活泼一点"、"加入对咖啡的热爱"
}
Response: SSE stream (text/event-stream)
```

- 使用 Gateway 环境变量配置的 API key 调用 LLM
- 所有字段可选，按提供的信息组合上下文
- `prompt` 作为用户意见注入，优先级最高
- `existingPersona` 存在时做扩充/调整而非重新生成
- **生成风格：** 有性格、有趣，包含性格特点、沟通风格、工作习惯、小癖好等，不是干巴巴的职责描述
- 不持久化 — 前端拿到结果后由用户确认填入表单
- 需要 JwtAuthGuard 鉴权

## 4. Backend API — 头像 AI 生成

```
POST /v1/installed-applications/:id/common-staff/generate-avatar
Body: {
  style: 'realistic' | 'cartoon' | 'anime' | 'notion-lineart'
  displayName?: string
  roleTitle?: string
  persona?: string
  prompt?: string              // 用户额外指令，如"戴眼镜"、"红色短发"
}
Response: { avatarUrl: string }
```

- 使用 Gateway 环境变量配置的 image generation API key
- 根据 style 预设不同的基础 prompt 模板，结合员工信息生成
- 生成结果上传到文件服务，返回 URL
- 需要 JwtAuthGuard 鉴权

**四种预设风格：**

| style            | 说明              |
| ---------------- | ----------------- |
| `realistic`      | 真人风格肖像      |
| `cartoon`        | 卡通插画风        |
| `anime`          | 二次元风格        |
| `notion-lineart` | Notion 黑白线条风 |

## 5. Backend API — 招聘式候选人生成

```
POST /v1/installed-applications/:id/common-staff/generate-candidates
Body: {
  jobTitle?: string
  jobDescription?: string
}
Response: SSE stream (text/event-stream)
```

- 流式生成 3 个候选人角色卡（包含 displayName、roleTitle、persona、性格摘要）
- 前端逐个渲染候选人工牌
- 用户可选择其中一个，也可重新 roll
- 需要 JwtAuthGuard 鉴权

## 6. Claw-Hive 注册

创建 bot 后调用 `clawHiveService.registerAgent()` 注册：

```typescript
clawHiveService.registerAgent({
  id: `common-staff-${botId}`,
  name: displayName,
  blueprintId: "team9-common-staff",
  tenantId,
  model: { provider, id },
  metadata: { tenantId, botId, mentorId },
  componentConfigs: {
    "system-prompt": { prompt: "You are a helpful AI assistant." },
    team9: {
      team9AuthToken: accessToken,
      botUserId: bot.userId,
      team9BaseUrl: env.API_URL,
    },
    "team9-staff-profile": {},
    "team9-staff-bootstrap": {},
    "team9-staff-soul": {},
  },
});
```

- **更新时：** `clawHiveService.updateAgent()` 同步 name、model、componentConfigs
- **删除时：** `clawHiveService.deleteAgent()` 注销

### 数据存储

roleTitle、persona、jobDescription、model 等 common-staff 特有字段存储在 `im_bots.extra` JSONB 中：

```typescript
interface BotExtra {
  openclaw?: { ... }           // 现有
  commonStaff?: {              // 新增
    roleTitle?: string
    persona?: string
    jobDescription?: string
    model: { provider: string; id: string }
  }
}
```

同时这些信息通过 claw-hive 的 `componentConfigs` 同步到 agent 侧（team9-staff-profile 组件从 Team9 API 读取）。

## 7. Agentic 创建路径

当 `agenticBootstrap === true` 时的额外流程：

### 临时身份

- displayName 使用用户输入的名称，若未填则自动生成临时名（如"候选人1号"、"候选人2号"，递增）
- roleTitle / persona 留空，由 bootstrap 流程补充

### 触发 Bootstrap

创建完成后，team9 server 执行以下步骤：

1. 找到 mentor 与 bot 的 DM channel
2. 通过 WebSocket gateway 触发该 channel 的消息处理，创建 claw-hive session（复用现有的 DM 消息 → session 创建流程）
3. Session 上下文中包含 `isMentorDm: true` 和 bootstrap 触发标记

具体实现需匹配现有的 claw-hive session 创建机制（WebSocket gateway 中 DM 消息触发 session assign 的流程）。

- Session 上下文标记 `isMentorDm: true`
- `team9-staff-bootstrap` 组件据此启用 profile 编辑模式
- Agent 发出欢迎消息，引导 mentor 逐步设置 name → role → persona

### Bootstrap 结束

- 当 identity.name + role.title + persona.markdown 都已填写
- Agent 自动切换到正常工作模式

## 8. 前端 — 创建对话框（分步骤）

### Step 1（共用）：选择创建方式

三个选项卡/卡片：

- **UI 表单填写式** — 直接填写所有信息
- **Agentic 交互式** — AI 在私聊中引导 mentor 完成设置
- **招聘式** — 输入 JD，AI 生成候选人供挑选

### UI 表单式

**Step 2：基本信息**

- Display Name（必填）
- Role Title（必填）
- 岗位描述（可选）
- Mentor（下拉，默认当前用户）
- Model（下拉，默认 Claude Sonnet 4.6）

**Step 3：性格与属性**

- Persona 文本框 + "AI 生成"按钮（流式填充，可多次生成扩充）
- 可添加其他属性信息

**Step 4：头像**

- 上传自定义头像
- 从预设选择
- AI 生成（选择风格：realistic/cartoon/anime/notion-lineart）
- 最终展示 3D 工牌预览

### Agentic 交互式

**Step 2：配置**

- Model（下拉，默认 Claude Sonnet 4.6）
- 提交后创建 bot → 触发 bootstrap → 跳转 mentor DM

### 招聘式

**Step 2：职位需求**

- Job Title（可选）
- JD / 岗位描述（可选）

**Step 3：候选人选择**

- AI 流式生成 3 个候选人，以 3D 工牌形式展示
- 生成完成后可编辑每个候选人信息
- 选择一个候选人，或点击"重新生成"

**Step 4：配置确认**

- Model（下拉，默认 Claude Sonnet 4.6）
- Mentor（下拉，默认当前用户）
- 提交创建

## 9. 前端 — 详情页

在 `AIStaffDetailContent` 中为 common-staff 类型新增展示/编辑区块。

### Profile 卡片区

- 头像（可点击更换：上传/预设/AI 重新生成）
- Display Name（inline 编辑）
- Role Title（inline 编辑）
- 状态 badge（online/offline）
- "Chat" 按钮跳转 DM

### 信息区

| 字段     | 可编辑 | 说明                       |
| -------- | ------ | -------------------------- |
| Persona  | 是     | 文本编辑 + AI 重新生成按钮 |
| Model    | 是     | 下拉切换                   |
| Mentor   | 是     | 下拉选择 workspace 成员    |
| 岗位描述 | 是     | 文本编辑                   |
| 创建时间 | 否     | 只读                       |

后续可扩展更多模块。

### 操作

- 编辑后同步更新 team9 bot + claw-hive agent
- "删除员工"按钮，带确认对话框

### 类型区分

新增 type guard 识别 common-staff bot：通过 `managedProvider === 'hive'` + `managedMeta.agentId` 以 `common-staff-` 前缀判断。

## 10. 3D 工牌组件 — StaffBadgeCard

参考 [Vercel 3D Event Badge](https://vercel.com/blog/building-an-interactive-3d-event-badge-with-react-three-fiber)。

### 技术栈

- React Three Fiber + Drei + react-three-rapier
- 物理绳带（lanyard）悬挂效果，可拖拽晃动
- 正反面翻转交互（点击或拖拽旋转）
- Drei 的 RenderTexture 动态渲染文字内容

### 卡面内容

**正面：**

- 头像（大）
- Display Name
- Role Title
- Mentor 姓名/头像

**反面（flip 切换）：**

- Persona 摘要
- Model

### 使用场景

1. UI 表单式 Step 4 — 创建前工牌预览
2. 招聘式 Step 3 — 三个候选人以工牌形式展示
3. AI Staff 列表页 — 复用工牌组件展示员工卡片

### 降级方案

不支持 WebGL 的环境 fallback 到 2D 卡片（CSS flip 动画）。

## 11. 前端 — API Client

在 `apps/client/src/services/api/applications.ts` 中新增：

```typescript
// Staff CRUD
createCommonStaff(appId, body): Promise<{ botId, userId, agentId, displayName }>
updateCommonStaff(appId, botId, body): Promise<void>
deleteCommonStaff(appId, botId): Promise<void>

// AI 生成
generatePersona(appId, body): EventSource (SSE stream)
generateAvatar(appId, body): Promise<{ avatarUrl: string }>
generateCandidates(appId, body): EventSource (SSE stream)
```

### 新增类型

```typescript
interface CommonStaffBotInfo {
  botId: string;
  userId: string;
  username: string;
  displayName: string | null;
  roleTitle: string | null;
  persona: string | null;
  jobDescription: string | null;
  avatarUrl: string | null;
  model: { provider: string; id: string };
  mentorId: string | null;
  mentorDisplayName: string | null;
  mentorAvatarUrl: string | null;
  isActive: boolean;
  createdAt: string;
  managedMeta: { agentId: string };
}
```

## 12. 硬编码模型列表

Key 通过 OpenRouter 接入，team9 端只维护可选列表：

```typescript
const COMMON_STAFF_MODELS = [
  {
    provider: "anthropic",
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    default: true,
  },
  { provider: "anthropic", id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { provider: "openai", id: "gpt-4.1", label: "GPT-4.1" },
  { provider: "openai", id: "o3", label: "o3" },
  { provider: "google", id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
];
```

运行时 key 由 claw-hive 侧管理，team9 不涉及。
