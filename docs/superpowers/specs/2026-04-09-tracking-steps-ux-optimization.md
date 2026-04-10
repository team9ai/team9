# Agent 执行步骤显示优化设计文档

**日期：** 2026-04-09  
**作者：** Claude Code  
**状态：** 设计阶段

---

## 1. 目标

优化 Agent 执行步骤的显示，减少信息噪音，让用户专注于最新进展和最终结果，同时保留完整的细节信息供需要时查阅。

**关键成果：**

- ✅ 信息分层展示，降低认知负荷
- ✅ 自动折叠旧步骤，突出最新进展
- ✅ 友好文案 + 关键参数摘要
- ✅ Thinking 和工具调用优化展示

---

## 2. 核心改进

### 从现状：

```
Turn 1
Calling load_tools(...)
Result ...
Calling search_tools(...)
Result ...
Calling invoke_tool(SendToChannel)
Result ...
[AI 回复内容]
Turn 2
...
```

### 到新状态：

信息分层、自动折叠、友好文案、参数摘要

---

## 3. 显示流程（实际场景）

### 场景 A: Session 初始化 + 第一条回复

```
正在warming up...

─────────────────────────────────────
└─ Thinking (1200 tokens, 2分3秒) ▶
└─ 正在加载工具 search_docs, send_message [绿点闪动]
└─ 工具加载完成 ✓
└─ 正在搜索工具 "reply" [绿点闪动]
└─ 工具搜索完成 - 找到 5 个工具 ✓
└─ 正在调用工具 SendToChannel(general, "我们来讨论...(45 words more)") [绿点闪动]
└─ 工具 SendToChannel 调用完成 ✓
[AI 第一条回复内容]
```

**说明：**

- `warming up` 一出现就消失（第一条回复返回时）
- Thinking 默认折叠，显示统计信息（token数、耗时）
- 工具步骤展开显示，显示关键参数
- 回复内容在最后

---

### 场景 B: 第二条回复在生成中（第一条已完成）

```
... 查看执行过程（3 步）
[AI 第一条回复内容]

─────────────────────────────────────
└─ Thinking (800 tokens, 1分2秒) ▶
└─ 正在搜索文档 query="user feedback" [绿点闪动]
└─ 文档搜索完成 - 找到 12 条结果 ✓
└─ 正在调用工具 SendToChannel(general, "根据用户反馈...(52 words more)") [绿点闪动]
[AI 第二条回复内容还在生成...]
```

**说明：**

- 第一条的步骤自动折叠成摘要 `... 查看执行过程（3 步）`
- 最新一轮（第二条）的步骤展开显示
- Thinking 进行中或完成时显示 token 数和耗时
- 最新一轮回复还没完全返回，步骤保持闪动

---

### 场景 C: 第二条完成，第三条在执行中

```
... 查看执行过程（3 步）
[AI 第一条回复内容]

... 查看执行过程（2 步）
[AI 第二条回复内容]

─────────────────────────────────────
└─ Thinking (600 tokens, 0分45秒) ▶
└─ 正在调用工具 InvokeAPI(endpoint="/v1/search", query="team performance") [绿点闪动]
[AI 第三条回复内容]  ← 还没出来，下面步骤继续闪动
```

**说明：**

- 第一、二条都折叠
- 最新一轮（第三条）永远展开
- 最新一轮回复还没返回，步骤保持闪动

---

### 场景 D: 某轮只有 Thinking，无回复内容

```
... 查看执行过程（1 步）
[AI 回复内容]

└─ Thinking (2000 tokens, 3分0秒) ▶
```

**说明：**

- 只有 Thinking 的轮次，在新轮次开始时也会被折叠
- Thinking 可点击展开看思考过程

---

## 4. 文案系统

### 4.1 操作类型文案映射

```typescript
const operationLabels = {
  // load_tools 操作
  load_tools: {
    loading: "正在加载工具",
    success: "工具加载完成",
    error: "工具加载失败",
  },
  // search_tools 操作
  search_tools: {
    loading: "正在搜索工具",
    success: "工具搜索完成",
    error: "工具搜索失败",
  },
  // invoke_tool 操作
  invoke_tool: {
    loading: "正在调用工具",
    success: "工具调用完成",
    error: "工具调用失败",
  },
};
```

### 4.2 工具名称文案映射（优先级高）

```typescript
const toolNameLabels = {
  search_docs: {
    loading: "正在搜索文档",
    success: "文档搜索完成",
    error: "文档搜索失败",
  },
  send_message: {
    loading: "正在发送消息",
    success: "消息发送完成",
    error: "消息发送失败",
  },
  generate_reply: {
    loading: "正在生成回复",
    success: "回复生成完成",
    error: "回复生成失败",
  },
  // ... 更多工具
};
```

### 4.3 文案获取逻辑（含 Fallback）

```typescript
const getLabel = (
  type: string,
  toolName: string | undefined,
  status: "loading" | "success" | "error",
) => {
  // 优先级 1: 工具名称
  if (toolName && toolNameLabels[toolName]?.[status]) {
    return toolNameLabels[toolName][status];
  }

  // 优先级 2: 操作类型
  if (operationLabels[type]?.[status]) {
    return operationLabels[type][status];
  }

  // Fallback 到通用格式
  const baseText = `loading工具 ${toolName || type}`;
  if (status === "loading") return `正在${baseText}`;
  if (status === "success") return `${baseText} 完成`;
  return `${baseText} 失败`;
};
```

---

## 5. 参数友好化显示

### 5.1 参数配置

```typescript
const toolParamConfig = {
  SendToChannel: {
    keyParams: ["channelName", "message"],
    truncate: { message: 50 },
  },
  SearchDocs: {
    keyParams: ["query", "limit"],
    truncate: { query: 80 },
  },
  InvokeAPI: {
    keyParams: ["endpoint", "query"],
    truncate: { query: 60 },
  },
  // ... 更多工具配置
};
```

### 5.2 参数格式化

```typescript
const formatParams = (toolName: string, params: Record<string, any>) => {
  const config = toolParamConfig[toolName];

  if (!config) {
    // Fallback: 显示完整 JSON
    return JSON.stringify(params);
  }

  return config.keyParams
    .map((key) => {
      let value = params[key];
      if (config.truncate?.[key] && typeof value === "string") {
        if (value.length > config.truncate[key]) {
          const remaining = value.length - config.truncate[key];
          value = `${value.slice(0, config.truncate[key])}...(${remaining} words more)`;
        }
      }
      return `${key}="${value}"`;
    })
    .join(", ");
};
```

### 5.3 显示示例

```
└─ 正在调用工具 SendToChannel(channelName="general", message="我们来讨论...(45 words more)") [绿点闪动]
└─ 正在搜索文档 query="user feedback", limit="10" [绿点闪动]
└─ 正在加载工具 search_docs, send_message [绿点闪动]
```

**点击展开后显示：** 完整参数 JSON

---

## 6. 交互细节

| 元素             | 状态     | 显示格式                                              | 交互                   |
| ---------------- | -------- | ----------------------------------------------------- | ---------------------- |
| **Thinking**     | 进行中   | `Thinking (1200 tokens, 2分3秒) ▶`                    | 点击展开内容           |
| **Thinking**     | 完成     | `Thinking (1200 tokens, 2分3秒) ▼`                    | 点击展开/收起内容      |
| **load_tools**   | 进行中   | `正在加载工具 search_docs, send_message` + 绿点闪     | -                      |
| **load_tools**   | 成功     | `工具加载完成` + 绿点 + ✓                             | 点击展开完整列表       |
| **load_tools**   | 失败     | `工具加载失败` + 红点 + ✗                             | 点击展开错误信息       |
| **search_tools** | 进行中   | `正在搜索工具 "reply"` + 绿点闪                       | -                      |
| **search_tools** | 成功     | `工具搜索完成 - 找到 5 个工具` + 绿点 + ✓             | 点击展开工具列表       |
| **search_tools** | 失败     | `工具搜索失败` + 红点 + ✗                             | 点击展开错误信息       |
| **invoke_tool**  | 进行中   | `正在调用工具 SendToChannel(general, "...")` + 绿点闪 | -                      |
| **invoke_tool**  | 成功     | `工具 SendToChannel 调用完成` + 绿点 + ✓              | 点击展开参数和返回结果 |
| **invoke_tool**  | 失败     | `工具 SendToChannel 调用失败` + 红点 + ✗              | 必须展开，显示错误详情 |
| **摘要条**       | 展开状态 | `... 查看执行过程（3 步）`                            | 点击展开/收起该轮步骤  |
| **回复内容**     | 完成     | 用户可见的最终输出                                    | -                      |

---

## 7. 关键逻辑规则

### ✅ 自动折叠触发条件

- 当有**新的 AI 回复内容返回**时
- 上一轮的**所有步骤**（Thinking + 工具调用）**自动折叠**成 `... 查看执行过程（N 步）`

### ✅ 永远展开

- 最新一轮的步骤永远展开显示
- 无论是 Thinking 还是工具调用都不折叠
- 让用户实时看到当前执行进度

### ❌ 不能折叠

- 最新一轮回复还没返回时（执行中）
- 执行中的步骤始终保持闪动状态，持续展开

### ✅ 特殊处理

- **Turn N 隐藏**：不显示"Turn 1"、"Turn 2"等标记
- **Warming up 消失**：第一条回复返回时自动隐藏
- **Thinking 默认折叠**：显示统计信息（token数、耗时）
- **Thinking 无绿点**：只有折叠/展开指示器

---

## 8. 受影响的组件

| 组件                       | 变化说明                                                                         |
| -------------------------- | -------------------------------------------------------------------------------- |
| `TrackingEventItem.tsx`    | 隐藏 Turn N；支持折叠状态显示摘要；Thinking 默认折叠+显示统计信息                |
| `ToolCallBlock.tsx`        | 合并工具调用为一行展示；使用文案映射系统；参数友好化显示；点击展开完整参数和结果 |
| `TrackingCard.tsx`         | 调整预览逻辑；考虑显示摘要而非最后3步；支持展开/收起摘要                         |
| `TrackingModal.tsx`        | 主要显示逻辑；支持折叠/展开互动；实现自动折叠逻辑                                |
| 新增：`useTrackingFold.ts` | Hook 控制折叠状态和自动折叠触发                                                  |
| 新增：`toolLabels.ts`      | 工具文案映射配置（可后续外部化给 agent 侧）                                      |
| 新增：`toolParamConfig.ts` | 工具参数配置文件（关键参数、截断规则）                                           |

---

## 9. 实现注意事项

1. **文案来源**
   - 现在在 team9 侧硬编码（`toolLabels.ts`）
   - 后续由 agent 侧提供（含多语言支持）
   - 需要预留接口方便后续替换

2. **参数显示**
   - 优先显示配置中的 keyParams
   - 不在配置中的工具 fallback 显示完整 JSON
   - 参数值超长时自动截断并显示"(N words more)"提示

3. **折叠状态管理**
   - 用 Hook 管理折叠状态（哪轮被折叠、展开状态等）
   - 新回复返回时自动更新折叠状态（不需手动触发）

4. **性能考虑**
   - Thinking 完整内容（可能很长）默认不加载到 DOM
   - 只在点击展开时加载
   - 参数 JSON 格式化仅在展开时进行

---

## 10. 后续迭代

- [ ] Agent 侧接管文案和多语言支持
- [ ] 支持更多工具的参数配置
- [ ] 考虑参数分析功能（统计调用频率等）
- [ ] 支持批量展开/收起所有摘要
