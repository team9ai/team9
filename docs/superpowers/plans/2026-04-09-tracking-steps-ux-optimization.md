# Agent 执行步骤显示优化 - 实现计划

> **For agentic workers:** 推荐使用 superpowers-extended-cc:subagent-driven-development 执行此计划。每个任务标记为 `- [ ]` 形式跟踪进度。

**Goal:** 优化 Agent 执行步骤的显示，实现信息分层、自动折叠、友好文案和参数摘要

**Architecture:**

- 建立三层配置系统（文案映射 + 参数配置 + Hook 状态管理）
- 修改现有组件以支持折叠/展开和自动折叠逻辑
- 使用 TDD 方法确保 100% 覆盖率

**Tech Stack:** React 19, TypeScript 5.8+, Zustand, TanStack React Query, Jest

---

## 文件结构概览

### 新增文件

- `apps/client/src/config/toolLabels.ts` - 工具文案映射配置
- `apps/client/src/config/toolParamConfig.ts` - 工具参数配置
- `apps/client/src/hooks/useTrackingFold.ts` - 折叠状态管理 Hook
- `apps/client/src/hooks/__tests__/useTrackingFold.test.ts` - Hook 测试

### 修改文件

- `apps/client/src/components/channel/TrackingEventItem.tsx` - 修改以支持文案映射和折叠
- `apps/client/src/components/channel/TrackingEventItem.test.tsx` - 新增或扩展测试
- `apps/client/src/components/channel/ToolCallBlock.tsx` - 一行显示 + 参数摘要
- `apps/client/src/components/channel/ToolCallBlock.test.tsx` - 新增或扩展测试
- `apps/client/src/components/channel/TrackingCard.tsx` - 支持折叠摘要显示
- `apps/client/src/components/channel/TrackingCard.test.tsx` - 新增或扩展测试
- `apps/client/src/components/channel/TrackingModal.tsx` - 实现自动折叠逻辑
- `apps/client/src/components/channel/TrackingModal.test.tsx` - 新增或扩展测试

---

## 任务分解

### Task 1: 创建工具文案映射配置

**Goal:** 建立可扩展的工具文案映射系统，支持操作类型和工具名两层映射

**Files:**

- Create: `apps/client/src/config/toolLabels.ts`
- Create: `apps/client/src/config/__tests__/toolLabels.test.ts`

**Acceptance Criteria:**

- [ ] 文案映射包含 load_tools、search_tools、invoke_tool 操作类型
- [ ] 支持工具名特定文案（优先级高于操作类型）
- [ ] getLabel 函数正确处理三层 fallback 逻辑
- [ ] 所有测试通过，100% 覆盖率

**Verify:** `pnpm test --testPathPattern="toolLabels.test" -- --coverage`

**Steps:**

- [ ] **Step 1: 编写测试文件**

创建 `apps/client/src/config/__tests__/toolLabels.test.ts`

```typescript
import { getLabel, operationLabels, toolNameLabels } from "../toolLabels";

describe("toolLabels", () => {
  describe("getLabel", () => {
    it("应该返回工具名称的文案（优先级最高）", () => {
      const result = getLabel("invoke_tool", "send_message", "loading");
      expect(result).toBe("正在发送消息");
    });

    it("应该使用操作类型的文案当工具名不存在", () => {
      const result = getLabel("load_tools", undefined, "loading");
      expect(result).toBe("正在加载工具");
    });

    it("应该 fallback 到通用格式", () => {
      const result = getLabel("unknown_op", "unknown_tool", "loading");
      expect(result).toMatch(/正在loading工具/);
    });

    it("应该处理 success 状态", () => {
      const result = getLabel("invoke_tool", "send_message", "success");
      expect(result).toBe("消息发送完成");
    });

    it("应该处理 error 状态", () => {
      const result = getLabel("invoke_tool", "send_message", "error");
      expect(result).toBe("消息发送失败");
    });

    it("应该在操作类型 fallback 中正确处理 success", () => {
      const result = getLabel("load_tools", "unknown_tool", "success");
      expect(result).toBe("工具加载完成");
    });

    it("应该在操作类型 fallback 中正确处理 error", () => {
      const result = getLabel("load_tools", "unknown_tool", "error");
      expect(result).toBe("工具加载失败");
    });

    it("应该处理 undefined toolName 的通用 fallback", () => {
      const result = getLabel("custom_operation", undefined, "loading");
      expect(result).toMatch(/正在loading工具 custom_operation/);
    });
  });

  describe("operationLabels", () => {
    it("应该包含 load_tools、search_tools、invoke_tool", () => {
      expect(operationLabels).toHaveProperty("load_tools");
      expect(operationLabels).toHaveProperty("search_tools");
      expect(operationLabels).toHaveProperty("invoke_tool");
    });

    it("每个操作类型应该有 loading、success、error", () => {
      Object.values(operationLabels).forEach((label) => {
        expect(label).toHaveProperty("loading");
        expect(label).toHaveProperty("success");
        expect(label).toHaveProperty("error");
      });
    });
  });

  describe("toolNameLabels", () => {
    it("应该包含常见工具名", () => {
      expect(toolNameLabels).toHaveProperty("search_docs");
      expect(toolNameLabels).toHaveProperty("send_message");
    });

    it("每个工具应该有 loading、success、error", () => {
      Object.values(toolNameLabels).forEach((label) => {
        expect(label).toHaveProperty("loading");
        expect(label).toHaveProperty("success");
        expect(label).toHaveProperty("error");
      });
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm test --testPathPattern="toolLabels.test" -- --no-coverage
```

Expected: FAIL - module not found

- [ ] **Step 3: 创建实现文件**

创建 `apps/client/src/config/toolLabels.ts`

```typescript
/**
 * 工具文案映射系统
 * 支持操作类型和工具名两层映射，后续可由 agent 侧提供
 */

export const operationLabels = {
  load_tools: {
    loading: "正在加载工具",
    success: "工具加载完成",
    error: "工具加载失败",
  },
  search_tools: {
    loading: "正在搜索工具",
    success: "工具搜索完成",
    error: "工具搜索失败",
  },
  invoke_tool: {
    loading: "正在调用工具",
    success: "工具调用完成",
    error: "工具调用失败",
  },
} as const;

export const toolNameLabels: Record<
  string,
  { loading: string; success: string; error: string }
> = {
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
};

export type LabelStatus = "loading" | "success" | "error";

/**
 * 获取工具操作的文案
 * 优先级：工具名 > 操作类型 > 通用 fallback
 */
export function getLabel(
  operationType: string,
  toolName: string | undefined,
  status: LabelStatus,
): string {
  // 优先级 1: 工具名称
  if (toolName && toolNameLabels[toolName]?.[status]) {
    return toolNameLabels[toolName][status];
  }

  // 优先级 2: 操作类型
  if (
    operationLabels[operationType as keyof typeof operationLabels]?.[status]
  ) {
    return operationLabels[operationType as keyof typeof operationLabels][
      status
    ];
  }

  // Fallback 到通用格式
  const baseText = `loading工具 ${toolName || operationType}`;
  if (status === "loading") return `正在${baseText}`;
  if (status === "success") return `${baseText} 完成`;
  return `${baseText} 失败`;
}
```

- [ ] **Step 4: 运行测试验证通过**

```bash
pnpm test --testPathPattern="toolLabels.test" -- --coverage
```

Expected: PASS with 100% coverage

- [ ] **Step 5: 提交**

```bash
git add apps/client/src/config/toolLabels.ts apps/client/src/config/__tests__/toolLabels.test.ts
git commit -m "feat: add tool operation label mapping system

- Implement two-tier label mapping: operation type + tool name
- Fallback logic with three levels of priority
- Full test coverage for all scenarios

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 2: 创建工具参数配置

**Goal:** 建立参数摘要配置，支持关键参数选择和截断规则

**Files:**

- Create: `apps/client/src/config/toolParamConfig.ts`
- Create: `apps/client/src/config/__tests__/toolParamConfig.test.ts`

**Acceptance Criteria:**

- [ ] 参数配置支持关键参数列表和截断规则
- [ ] formatParams 函数正确提取关键参数
- [ ] 超长参数正确截断并显示 "(N words more)"
- [ ] 所有测试通过，100% 覆盖率

**Verify:** `pnpm test --testPathPattern="toolParamConfig.test" -- --coverage`

**Steps:**

- [ ] **Step 1: 编写测试文件**

创建 `apps/client/src/config/__tests__/toolParamConfig.test.ts`

```typescript
import { formatParams, toolParamConfig } from "../toolParamConfig";

describe("toolParamConfig", () => {
  describe("formatParams", () => {
    it("应该使用配置提取关键参数", () => {
      const params = {
        channelName: "general",
        message: "hello world",
        userId: "123",
      };
      const result = formatParams("SendToChannel", params);
      expect(result).toContain('channelName="general"');
      expect(result).toContain('message="hello world"');
      expect(result).not.toContain("userId");
    });

    it("应该截断超长参数并显示 (N words more)", () => {
      const params = {
        query: "a".repeat(100),
      };
      const result = formatParams("SearchDocs", params);
      expect(result).toMatch(/query="a+\.\.\..*words more/);
    });

    it("应该处理不在配置中的工具", () => {
      const params = { foo: "bar", baz: 123 };
      const result = formatParams("UnknownTool", params);
      expect(result).toContain(JSON.stringify(params));
    });

    it("应该正确处理数字参数", () => {
      const params = { limit: 10, offset: 0 };
      const result = formatParams("SearchDocs", params);
      expect(result).toContain('limit="10"');
    });

    it("应该只截断配置中指定的字段", () => {
      const longText = "a".repeat(100);
      const params = {
        query: longText,
        limit: "20",
      };
      const result = formatParams("SearchDocs", params);
      expect(result).toMatch(/query="a+\.\.\..*words more/);
      expect(result).toContain('limit="20"');
    });
  });

  describe("toolParamConfig", () => {
    it("应该包含常见工具的配置", () => {
      expect(toolParamConfig).toHaveProperty("SendToChannel");
      expect(toolParamConfig).toHaveProperty("SearchDocs");
    });

    it("每个配置应该有 keyParams 数组", () => {
      Object.values(toolParamConfig).forEach((config) => {
        expect(Array.isArray(config.keyParams)).toBe(true);
        expect(config.keyParams.length).toBeGreaterThan(0);
      });
    });
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

```bash
cd /Users/winrey/Projects/weightwave/team9
pnpm test --testPathPattern="toolParamConfig.test" -- --no-coverage
```

- [ ] **Step 3: 创建实现文件**

创建 `apps/client/src/config/toolParamConfig.ts`

```typescript
export interface ToolParamConfigItem {
  keyParams: string[];
  truncate?: Record<string, number>;
}

export const toolParamConfig: Record<string, ToolParamConfigItem> = {
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
};

export function formatParams(
  toolName: string,
  params: Record<string, any>,
): string {
  const config = toolParamConfig[toolName];
  if (!config) {
    return JSON.stringify(params);
  }

  return config.keyParams
    .map((key) => {
      let value = String(params[key] ?? "");
      if (config.truncate?.[key] && value.length > config.truncate[key]) {
        const truncateLen = config.truncate[key];
        const remaining = value.length - truncateLen;
        value = `${value.slice(0, truncateLen)}...(${remaining} words more)`;
      }
      return `${key}="${value}"`;
    })
    .join(", ");
}
```

- [ ] **Step 4: 运行测试**

```bash
pnpm test --testPathPattern="toolParamConfig.test" -- --coverage
```

- [ ] **Step 5: 提交**

```bash
git add apps/client/src/config/toolParamConfig.ts apps/client/src/config/__tests__/toolParamConfig.test.ts
git commit -m "feat: add tool parameter config with formatting

- Define keyParams and truncation rules per tool
- Implement formatParams with smart truncation
- Full test coverage

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

### Task 3: 创建 useTrackingFold Hook

**Goal:** 管理折叠状态，实现自动折叠逻辑

**Files:**

- Create: `apps/client/src/hooks/useTrackingFold.ts`
- Create: `apps/client/src/hooks/__tests__/useTrackingFold.test.ts`

**Acceptance Criteria:**

- [ ] Hook 跟踪每轮回复的折叠状态
- [ ] 新回复返回时自动折叠上一轮
- [ ] 最新一轮永不折叠
- [ ] 100% 测试覆盖

**Verify:** `pnpm test --testPathPattern="useTrackingFold.test" -- --coverage`

**Steps:** [跳过详细步骤示例，简述]

- [ ] 创建 Hook 管理 Map<roundId, isFolded>
- [ ] 实现 fold/unfold/autoFoldPrevious 方法
- [ ] 编写测试覆盖所有场景
- [ ] 提交

```typescript
// apps/client/src/hooks/useTrackingFold.ts
import { useCallback, useState } from "react";

export interface FoldState {
  isFolded: boolean;
  stepCount: number;
}

export function useTrackingFold() {
  const [foldMap, setFoldMap] = useState<Map<string, FoldState>>(new Map());

  const setFolded = useCallback(
    (roundId: string, isFolded: boolean, stepCount = 0) => {
      setFoldMap((prev) => {
        const next = new Map(prev);
        next.set(roundId, { isFolded, stepCount });
        return next;
      });
    },
    [],
  );

  const autoFoldPrevious = useCallback((latestRoundId: string) => {
    setFoldMap((prev) => {
      const next = new Map(prev);
      next.forEach((state, roundId) => {
        if (roundId !== latestRoundId) {
          next.set(roundId, { ...state, isFolded: true });
        }
      });
      return next;
    });
  }, []);

  const isFolded = useCallback(
    (roundId: string) => {
      return foldMap.get(roundId)?.isFolded ?? false;
    },
    [foldMap],
  );

  const getStepCount = useCallback(
    (roundId: string) => {
      return foldMap.get(roundId)?.stepCount ?? 0;
    },
    [foldMap],
  );

  return { setFolded, autoFoldPrevious, isFolded, getStepCount };
}
```

**提交:**

```bash
git add apps/client/src/hooks/useTrackingFold.ts apps/client/src/hooks/__tests__/useTrackingFold.test.ts
git commit -m "feat: add useTrackingFold hook for fold state management"
```

---

### Task 4: 修改 TrackingEventItem - Turn 隐藏和文案系统

**Goal:** 隐藏 Turn 标记，集成工具文案映射

**Files:**

- Modify: `apps/client/src/components/channel/TrackingEventItem.tsx:35-65`
- Modify: `apps/client/src/components/channel/TrackingEventItem.test.tsx`

**Acceptance Criteria:**

- [ ] Turn N 标记完全不显示
- [ ] 使用 getLabel 获取文案
- [ ] Thinking 显示默认折叠箭头
- [ ] 测试覆盖所有新逻辑

**Verify:** `pnpm test --testPathPattern="TrackingEventItem.test" -- --coverage`

**Steps:**

- [ ] 移除 turn_separator 分支的显示逻辑
- [ ] 在工具调用显示时调用 getLabel
- [ ] 更新 Thinking 样式（无绿点，只有箭头）
- [ ] 扩展测试
- [ ] 提交

---

### Task 5: 修改 ToolCallBlock - 一行展示和参数摘要

**Goal:** 合并工具调用为一行，显示关键参数

**Files:**

- Modify: `apps/client/src/components/channel/ToolCallBlock.tsx`
- Modify: `apps/client/src/components/channel/ToolCallBlock.test.tsx`

**Acceptance Criteria:**

- [ ] 工具调用一行显示含参数摘要
- [ ] 点击展开显示完整参数和结果
- [ ] 使用 formatParams 显示参数
- [ ] 失败时必须展开显示错误

**Verify:** `pnpm test --testPathPattern="ToolCallBlock.test" -- --coverage`

**Steps:**

- [ ] 重构组件结构，合并调用和结果为一行
- [ ] 集成 formatParams 显示参数摘要
- [ ] 更新展开状态逻辑
- [ ] 编写测试
- [ ] 提交

---

### Task 6: 修改 TrackingEventItem - Thinking 折叠和统计

**Goal:** 实现 Thinking 默认折叠，显示 token 和耗时

**Files:**

- Modify: `apps/client/src/components/channel/TrackingEventItem.tsx:60-100`
- Modify: `apps/client/src/components/channel/TrackingEventItem.test.tsx`

**Acceptance Criteria:**

- [ ] Thinking 默认折叠，显示箭头
- [ ] 显示 token 数和耗时 (分M秒S)
- [ ] 点击可展开看完整内容
- [ ] 进行中和完成状态有视觉区分

**Verify:** `pnpm test --testPathPattern="TrackingEventItem.test" -- --coverage`

**Steps:**

- [ ] 添加 ThinkingStats 接口用于显示统计
- [ ] 实现 formatDuration 函数（秒转分:秒）
- [ ] 修改 Thinking 显示逻辑
- [ ] 编写测试
- [ ] 提交

---

### Task 7: 修改 TrackingModal - 自动折叠逻辑

**Goal:** 实现回复返回时自动折叠上一轮步骤

**Files:**

- Modify: `apps/client/src/components/channel/TrackingModal.tsx`
- Modify: `apps/client/src/components/channel/TrackingModal.test.tsx`

**Acceptance Criteria:**

- [ ] 新回复返回时自动调用 autoFoldPrevious
- [ ] 最新一轮永不折叠
- [ ] useTrackingFold Hook 集成
- [ ] 测试自动折叠触发

**Verify:** `pnpm test --testPathPattern="TrackingModal.test" -- --coverage`

**Steps:**

- [ ] 集成 useTrackingFold Hook
- [ ] 监听消息列表变化，检测新回复
- [ ] 回复返回时调用 autoFoldPrevious
- [ ] 编写测试验证自动折叠
- [ ] 提交

---

### Task 8: 修改 TrackingCard - 摘要显示

**Goal:** 在卡片中显示折叠摘要 "... 查看执行过程（N 步）"

**Files:**

- Modify: `apps/client/src/components/channel/TrackingCard.tsx`
- Modify: `apps/client/src/components/channel/TrackingCard.test.tsx`

**Acceptance Criteria:**

- [ ] 折叠状态显示摘要条
- [ ] 摘要显示步骤数
- [ ] 点击摘要可展开
- [ ] 展开时显示所有步骤

**Verify:** `pnpm test --testPathPattern="TrackingCard.test" -- --coverage`

**Steps:**

- [ ] 添加 CollapseSummary 组件显示摘要
- [ ] 集成 useTrackingFold 状态
- [ ] 实现摘要条展开/收起交互
- [ ] 编写测试
- [ ] 提交

---

### Task 9: 处理 Warming up 状态

**Goal:** 显示 "AI正在warming up..." 状态，第一条回复返回时隐藏

**Files:**

- Modify: `apps/client/src/components/channel/TrackingCard.tsx`
- Modify: `apps/client/src/components/channel/TrackingModal.tsx`
- Modify: `apps/client/src/components/channel/TrackingCard.test.tsx`

**Acceptance Criteria:**

- [ ] Session 初始化时显示 warming up
- [ ] 第一条回复返回时自动隐藏
- [ ] 后续回复不显示 warming up
- [ ] 测试 warming up 生命周期

**Verify:** `pnpm test --testPathPattern="TrackingCard.test\|TrackingModal.test" -- --coverage`

**Steps:**

- [ ] 检测是否有任何实际回复内容
- [ ] 初始状态显示 warming up 提示
- [ ] 第一条真实回复返回时隐藏
- [ ] 编写集成测试
- [ ] 提交

---

### Task 10: 修改 ChannelContent 以支持 warming up

**Goal:** 在 ChannelContent 中集成 warming up 显示

**Files:**

- Modify: `apps/client/src/components/channel/ChannelContent.tsx`
- Modify: `apps/client/src/components/channel/__tests__/ChannelContent.test.tsx`

**Acceptance Criteria:**

- [ ] warming up 在消息列表上方显示
- [ ] 支持 tracking 频道类型
- [ ] 与 TrackingCard 协调显示

**Verify:** `pnpm test --testPathPattern="ChannelContent.test" -- --coverage`

**Steps:**

- [ ] 在消息列表顶部添加 warming up 提示
- [ ] 编写测试
- [ ] 提交

---

### Task 11: 集成测试 - 完整流程

**Goal:** 编写集成测试验证完整的执行流程和自动折叠

**Files:**

- Create: `apps/client/src/components/channel/__tests__/tracking-integration.test.ts`

**Acceptance Criteria:**

- [ ] 测试从 warming up 到多轮回复的完整流程
- [ ] 验证自动折叠逻辑
- [ ] 验证文案显示
- [ ] 验证参数摘要显示

**Verify:** `pnpm test --testPathPattern="tracking-integration.test" -- --coverage`

**Steps:**

- [ ] 编写完整场景测试（A-D 场景）
- [ ] 验证所有文案正确性
- [ ] 验证折叠状态转换
- [ ] 提交

---

### Task 12: 文档和后续扩展预留

**Goal:** 编写文档，预留 agent 侧扩展接口

**Files:**

- Create: `docs/tracking-steps-ux/IMPLEMENTATION.md`
- Update: `CLAUDE.md` 相关部分

**Acceptance Criteria:**

- [ ] 文档说明如何扩展工具文案配置
- [ ] 说明如何添加新工具参数配置
- [ ] 预留 agent 侧接管接口
- [ ] 列出所有可配置项

**Verify:** 文档完整，提供清晰的扩展指南

**Steps:**

- [ ] 编写实现说明文档
- [ ] 列出所有配置点和外部化计划
- [ ] 提交

---

## 总结

| Task | 名称                 | 关键输出                  |
| ---- | -------------------- | ------------------------- |
| 1    | 工具文案配置         | toolLabels.ts + 测试      |
| 2    | 工具参数配置         | toolParamConfig.ts + 测试 |
| 3    | Fold Hook            | useTrackingFold.ts + 测试 |
| 4    | TrackingEventItem 改 | Turn 隐藏 + 文案系统      |
| 5    | ToolCallBlock 改     | 一行显示 + 参数摘要       |
| 6    | Thinking 折叠        | 默认折叠 + 统计显示       |
| 7    | TrackingModal 改     | 自动折叠逻辑              |
| 8    | TrackingCard 改      | 摘要显示                  |
| 9    | Warming up           | 初始化状态管理            |
| 10   | ChannelContent 改    | warming up 集成           |
| 11   | 集成测试             | 完整流程验证              |
| 12   | 文档                 | 扩展指南                  |

---

## 执行顺序建议

**第一阶段（配置）：** Task 1, 2

- 无依赖，可并行
- 建立所有配置系统

**第二阶段（基础设施）：** Task 3

- 依赖 Task 1, 2
- Hook 为后续 Task 基础

**第三阶段（组件改造）：** Task 4, 5, 6, 7, 8, 9, 10

- 依赖 Task 1, 2, 3
- 大部分可并行执行
- Task 7 依赖 Task 4, 5, 6

**第四阶段（验证和文档）：** Task 11, 12

- 依赖所有前置 Task
- 完整验证

---
