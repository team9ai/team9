# Agent 聊天页"新建 topic"入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在与 bot 的一对一聊天页（`topic-session` 或 bot `direct` DM）的频道头部右侧加一个"新建 topic"图标按钮，点击跳到 dashboard composer 并预选该 agent。

**Architecture:** 纯前端改动。新增一个共享 helper `navigateToNewTopic(navigate, agentUserId)`（封装 `navigate({ to: "/channels", search: { agentId } })`），让侧边栏 `AgentGroupList` 和 `ChannelHeader` 共用同一段导航逻辑。`ChannelHeader` 已计算出 `associatedAgent`，据此判断是否渲染按钮。无后端 / DB / 路由定义改动。

**Tech Stack:** React 19 + TypeScript, TanStack Router, react-i18next, lucide-react, shadcn `Button`/`Tooltip`, Vitest + Testing Library。

参考设计文档：`docs/superpowers/specs/2026-05-11-agent-chat-new-topic-entry-design.md`

---

### Task 1: 共享 helper `navigateToNewTopic`

**Files:**

- Create: `apps/client/src/lib/agent-topics.ts`
- Create: `apps/client/src/lib/__tests__/agent-topics.test.ts`

- [ ] **Step 1: 写失败测试**

`apps/client/src/lib/__tests__/agent-topics.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { navigateToNewTopic } from "../agent-topics";

describe("navigateToNewTopic", () => {
  it("navigates to the dashboard composer with the agent pre-selected", () => {
    const navigate = vi.fn();
    navigateToNewTopic(navigate as never, "agent-user-42");
    expect(navigate).toHaveBeenCalledWith({
      to: "/channels",
      search: { agentId: "agent-user-42" },
    });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/client && pnpm vitest run src/lib/__tests__/agent-topics.test.ts`
Expected: FAIL — cannot find module `../agent-topics`.

- [ ] **Step 3: 实现 helper**

`apps/client/src/lib/agent-topics.ts`:

```ts
import type { useNavigate } from "@tanstack/react-router";

/**
 * Navigate to the dashboard composer with the given agent pre-selected, so the
 * user can start a fresh topic-session with that agent. Shared by the sidebar
 * agent-group "+" button and the in-chat header "new topic" button so both
 * stay in sync.
 */
export function navigateToNewTopic(
  navigate: ReturnType<typeof useNavigate>,
  agentUserId: string,
): void {
  void navigate({ to: "/channels", search: { agentId: agentUserId } });
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd apps/client && pnpm vitest run src/lib/__tests__/agent-topics.test.ts`
Expected: PASS。

- [ ] **Step 5: 类型检查**

Run: `cd apps/client && pnpm tsc --noEmit` (或项目的 `pnpm typecheck`，按 `apps/client/package.json` 的 script 名)
Expected: 无新增错误。若 `ReturnType<typeof useNavigate>` 标注导致问题，退化为 `navigate: (opts: { to: "/channels"; search: { agentId: string } }) => unknown`。

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/lib/agent-topics.ts apps/client/src/lib/__tests__/agent-topics.test.ts
git commit -m "feat(client): add navigateToNewTopic helper for starting agent topics"
```

---

### Task 2: `AgentGroupList` 改用共享 helper

**Files:**

- Modify: `apps/client/src/components/sidebar/AgentGroupList.tsx` (`handleNewTopic`, 约 L156-165)

- [ ] **Step 1: 改 `handleNewTopic` 调用 helper**

在 `AgentGroupList.tsx` 顶部 import 区加：

```ts
import { navigateToNewTopic } from "@/lib/agent-topics";
```

把 `handleNewTopic` 改成：

```ts
const handleNewTopic = (event: MouseEvent<HTMLButtonElement>) => {
  event.stopPropagation();
  // Route back to the dashboard composer with the clicked agent pre-selected
  // via search param, so the composer header reflects the correct agent
  // instead of falling back to the dashboard's last-remembered selection.
  navigateToNewTopic(navigate, group.agentUserId);
};
```

（删掉原来内联的 `void navigate({ to: "/channels", search: { agentId: group.agentUserId } });`。）

- [ ] **Step 2: 跑 AgentGroupList 现有测试**

Run: `cd apps/client && pnpm vitest run src/components/sidebar/__tests__/AgentGroupList.test.tsx`
Expected: PASS（行为未变）。

- [ ] **Step 3: 类型检查**

Run: `cd apps/client && pnpm tsc --noEmit`
Expected: 无新增错误。

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/components/sidebar/AgentGroupList.tsx
git commit -m "refactor(client): use navigateToNewTopic helper in AgentGroupList"
```

---

### Task 3: `ChannelHeader` 加"新建 topic"按钮 — 测试先行

**Files:**

- Create: `apps/client/src/components/channel/__tests__/ChannelHeader.newTopic.test.tsx`

> 说明：参照同目录已有的 `ChannelHeader.badge.test.tsx` 的 mock 套路（mock `react-i18next`、`@/hooks/useChannels`、`@/hooks/useIMUsers` 等）。本任务**额外**要 mock `@tanstack/react-router` 的 `useNavigate`。新测试文件只覆盖"新建 topic"按钮相关行为，不动 badge 测试。

- [ ] **Step 1: 写失败测试**

`apps/client/src/components/channel/__tests__/ChannelHeader.newTopic.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { ChannelHeader } from "../ChannelHeader";
import type { ChannelWithUnread } from "@/types/im";

const navigateMock = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("@/hooks/useChannels", () => ({
  useChannelMembers: () => ({ data: [] }),
  useUpdateChannel: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useIMUsers", () => ({
  useIsUserOnline: () => false,
}));

// Avoid pulling heavy modal/dialog trees into the render.
vi.mock("../ChannelDetailsModal", () => ({ ChannelDetailsModal: () => null }));
vi.mock("../AddMemberDialog", () => ({ AddMemberDialog: () => null }));

const bot = {
  id: "agent-user-1",
  username: "idea-curator",
  displayName: "Idea Curator",
  userType: "bot" as const,
  avatarUrl: null,
};

function makeChannel(overrides: Partial<ChannelWithUnread>): ChannelWithUnread {
  return {
    id: "chan-1",
    name: "Some topic",
    type: "topic-session",
    otherUser: bot,
    ...overrides,
  } as ChannelWithUnread;
}

describe("ChannelHeader — new topic button", () => {
  beforeEach(() => {
    navigateMock.mockReset();
  });

  it("shows the new-topic button for a topic-session with a bot", () => {
    render(<ChannelHeader channel={makeChannel({})} />);
    const btn = screen.getByLabelText("新建话题");
    fireEvent.click(btn);
    expect(navigateMock).toHaveBeenCalledWith({
      to: "/channels",
      search: { agentId: "agent-user-1" },
    });
  });

  it("shows the new-topic button for a direct DM with a bot", () => {
    render(<ChannelHeader channel={makeChannel({ type: "direct" })} />);
    expect(screen.getByLabelText("新建话题")).toBeInTheDocument();
  });

  it("does not show the button for a direct DM with a human user", () => {
    render(
      <ChannelHeader
        channel={makeChannel({
          type: "direct",
          otherUser: { ...bot, userType: "user" as const },
        })}
      />,
    );
    expect(screen.queryByLabelText("新建话题")).not.toBeInTheDocument();
  });

  it("does not show the button for a routine-session", () => {
    render(
      <ChannelHeader channel={makeChannel({ type: "routine-session" })} />,
    );
    expect(screen.queryByLabelText("新建话题")).not.toBeInTheDocument();
  });

  it("does not show the button for a public channel", () => {
    render(
      <ChannelHeader
        channel={makeChannel({ type: "public", otherUser: undefined })}
      />,
    );
    expect(screen.queryByLabelText("新建话题")).not.toBeInTheDocument();
  });
});
```

> 实现注意：若 `ChannelHeader` 还 import 了别的 hook（如 `UserHoverCard` 内部用到的），按 `ChannelHeader.badge.test.tsx` 已有的 mock 列表补齐 mock，使 `render` 不报错。`getByLabelText("新建话题")` 依赖 i18n key `navigation:newTopic` 的 `defaultValue: "新建话题"`（见 `AgentGroupList.tsx` L216-223）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/client && pnpm vitest run src/components/channel/__tests__/ChannelHeader.newTopic.test.tsx`
Expected: FAIL — 第一个用例 `getByLabelText("新建话题")` 找不到元素（按钮还没实现）。

> 如果 FAIL 原因是 render 直接抛错（缺 mock），先补 mock 直到失败原因变成"找不到按钮"，再进入 Step 3。

- [ ] **Step 3: Commit 测试**

```bash
git add apps/client/src/components/channel/__tests__/ChannelHeader.newTopic.test.tsx
git commit -m "test(client): cover new-topic button in ChannelHeader"
```

---

### Task 4: `ChannelHeader` 实现"新建 topic"按钮

**Files:**

- Modify: `apps/client/src/components/channel/ChannelHeader.tsx`

- [ ] **Step 1: 加 imports**

在 `ChannelHeader.tsx` 顶部：

- `lucide-react` import 里加 `SquarePen`：
  ```ts
  import {
    Check,
    Copy,
    Hash,
    Lock,
    Info,
    Users,
    UserPlus,
    Pencil,
    SquarePen,
    X,
  } from "lucide-react";
  ```
- 新增：

  ```ts
  import { useNavigate } from "@tanstack/react-router";
  import { navigateToNewTopic } from "@/lib/agent-topics";
  ```

- [ ] **Step 2: i18n namespace + navigate**

把 `const { t } = useTranslation("channel");` 改为：

```ts
const { t } = useTranslation(["channel", "navigation"]);
const navigate = useNavigate();
```

> 验证 `ChannelHeader` 里其它 `t(...)` 调用仍解析到 `channel` namespace（`useTranslation(["channel", "navigation"])` 的默认 ns 是数组第一项 `channel`，所以现有调用不受影响）。

- [ ] **Step 3: 加判断**

在 `associatedAgent` 计算之后（约 L72 后面），加：

```ts
// One-on-one conversation with an AI agent (topic-session or a plain bot DM,
// but NOT routine-session) — these get an in-chat "new topic" entry point.
const isOneOnOneAgentChat =
  (channel.type === "topic-session" || channel.type === "direct") &&
  associatedAgent?.userType === "bot";
```

- [ ] **Step 4: 渲染按钮**

在右侧按钮区 `<div className="flex items-center gap-1">`（约 L319）里，作为**第一个**子元素插入：

```tsx
{
  isOneOnOneAgentChat && associatedAgent && (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("newTopic", {
              ns: "navigation",
              defaultValue: "新建话题",
            })}
            onClick={() => navigateToNewTopic(navigate, associatedAgent.id)}
          >
            <SquarePen size={18} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {t("newTopic", { ns: "navigation", defaultValue: "新建话题" })}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

> `TooltipProvider` / `Tooltip` / `TooltipTrigger` / `TooltipContent` / `Button` 已在文件顶部 import，无需新增。

- [ ] **Step 5: 跑新测试确认通过**

Run: `cd apps/client && pnpm vitest run src/components/channel/__tests__/ChannelHeader.newTopic.test.tsx`
Expected: 5 个用例全 PASS。

- [ ] **Step 6: 跑 ChannelHeader 现有测试 + 类型检查**

Run: `cd apps/client && pnpm vitest run src/components/channel/__tests__/ChannelHeader.badge.test.tsx && pnpm tsc --noEmit`
Expected: PASS，无新增类型错误。

> 注意：`ChannelHeader.badge.test.tsx` 目前没 mock `@tanstack/react-router`。`ChannelHeader` 现在调用 `useNavigate()`，会导致该测试报错（缺 Router context）。修复：在 `ChannelHeader.badge.test.tsx` 的 mock 区加 `vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));`（仿照 `AgentGroupList.test.tsx`）。这属于本任务的一部分。

- [ ] **Step 7: Commit**

```bash
git add apps/client/src/components/channel/ChannelHeader.tsx apps/client/src/components/channel/__tests__/ChannelHeader.badge.test.tsx
git commit -m "feat(client): add in-chat new-topic button to agent ChannelHeader"
```

---

### Task 5: 全量验证

- [ ] **Step 1: 跑 client 全部相关测试**

Run: `cd apps/client && pnpm vitest run src/lib/__tests__/agent-topics.test.ts src/components/sidebar/__tests__/AgentGroupList.test.tsx src/components/channel/__tests__/ChannelHeader.newTopic.test.tsx src/components/channel/__tests__/ChannelHeader.badge.test.tsx`
Expected: 全 PASS。

- [ ] **Step 2: 类型检查 + lint**

Run: `cd apps/client && pnpm tsc --noEmit && pnpm lint`
Expected: 无错误（lint 若报新文件格式问题，按 prettier 自动修）。

- [ ] **Step 3: 手动冒烟（可选，需起 dev server）**

`pnpm dev:client`，打开一个 topic-session 频道 → 头部右侧出现 `SquarePen` 按钮 → hover 显示"新建话题" → 点击跳到 dashboard 且 composer 预选该 agent。再开一个和 bot 的普通 DM 重复验证；开一个 routine-session / public 频道确认无按钮。

- [ ] **Step 4: 最终 commit（如有 lint 自动修改）**

```bash
git add -A
git commit -m "chore(client): lint fixes for new-topic entry" || echo "nothing to commit"
```

---

## Self-Review

**1. Spec coverage:**

- 范围（topic-session + bot direct，排除 routine-session）→ Task 4 Step 3 的 `isOneOnOneAgentChat` + Task 3 的 5 个用例 ✅
- 行为（跳 `/channels?agentId=`）→ Task 1 helper + Task 4 Step 4 ✅
- 两处共用导航逻辑 → Task 1 helper，Task 2 让 `AgentGroupList` 改用 ✅
- 文案复用 `navigation:newTopic` → Task 4 Step 2 改 namespace + Step 4 用 key ✅
- 图标 `SquarePen`、放在头部右侧 → Task 4 Step 4 ✅
- 不新增网络请求 → 仅用已有的 `associatedAgent` ✅
- 测试覆盖各频道类型显隐 + 点击导航 → Task 3 ✅；helper 单测 → Task 1 ✅
- 风险点（`useTranslation` namespace、`navigate` 类型标注）→ Task 4 Step 2 注释、Task 1 Step 5 注释 ✅

无遗漏。

**2. Placeholder scan:** 无 TBD / "实现 later" / 空 test。"可选"的手动冒烟步骤是真实可执行的指引，非占位符。

**3. Type consistency:** `navigateToNewTopic(navigate, agentUserId)` 在 Task 1 定义、Task 2 与 Task 4 调用，签名一致。`isOneOnOneAgentChat`、`associatedAgent` 命名前后一致。i18n key 统一用 `newTopic` + `ns: "navigation"` + `defaultValue: "新建话题"`。
