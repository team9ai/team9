# Agent 聊天页"新建 topic"入口 — 设计文档

- 日期：2026-05-11
- 状态：待实现
- 范围：仅前端（`apps/client`），无后端 / DB 改动

## 背景

"新建 topic"（新建话题）目前**只存在于左侧边栏**：在 [`AgentGroupList.tsx`](../../../apps/client/src/components/sidebar/AgentGroupList.tsx) 每个 agent 分组的标题右侧有一个 `SquarePen` 图标按钮（`handleNewTopic`，L156-165），点击后 `navigate({ to: "/channels", search: { agentId } })` —— 即跳到 dashboard 的 composer，并把该 agent 预选好；用户在 composer 里发出第一条消息时才由后端原子化创建一个 `topic-session` 频道。

和 agent 的"聊天"目前有三种频道类型走同一套 [`ChannelView`](../../../apps/client/src/components/channel/ChannelView.tsx) / [`ChannelHeader`](../../../apps/client/src/components/channel/ChannelHeader.tsx)：

- `topic-session` —— 话题会话（一对一，临时）
- `routine-session` —— routine 创建/反思的元对话（一对一）
- `direct`（对端 `userType === "bot"`）—— 和 bot 的普通持久 DM

需求：当用户正处在和某个 agent 的聊天页时，页面内也能直接"新建 topic"，不用先回侧边栏。

## 目标 / 非目标

**目标**

- 在与 bot 的一对一聊天页（`topic-session` 或 `direct` 且对端是 bot；**不含** `routine-session`）的频道头部右侧加一个"新建 topic"图标按钮。
- 行为与侧边栏 `+` 完全一致：跳到 `/channels?agentId=<对端 bot 的 userId>`。
- 侧边栏与头部两处共用同一段导航逻辑，避免行为漂移。

**非目标（YAGNI）**

- 不改后端、不新增"空 topic"接口、不改路由定义（`/channels` 的 `agentId` search param 已存在且侧边栏在用）。
- `routine-session` 频道不显示该按钮。
- 不做"原地清空上下文 / 重置 session"。
- 不动 dashboard composer 自身的逻辑。

## 设计

### 1. 共享导航 helper

新增 `apps/client/src/lib/agentTopics.ts`（或就近放到现有 `apps/client/src/lib/navigation` 类的工具文件 —— 实现时按现有目录约定选位）：

```ts
import type { useNavigate } from "@tanstack/react-router";

/**
 * Navigate to the dashboard composer with the given agent pre-selected, so the
 * user can start a fresh topic-session with that agent. Used by both the
 * sidebar agent-group "+" button and the in-chat header button.
 */
export function navigateToNewTopic(
  navigate: ReturnType<typeof useNavigate>,
  agentUserId: string,
): void {
  void navigate({ to: "/channels", search: { agentId: agentUserId } });
}
```

- `AgentGroupList.tsx` 的 `handleNewTopic` 改为调用 `navigateToNewTopic(navigate, group.agentUserId)`（保留原有 `event.stopPropagation()`）。
- 实现时确认 `useNavigate` 返回类型的导出方式与项目里其它 helper 的写法一致；如项目已有 `navigateToChannel(navigate, linkPrefix, channelId)` 这类签名（见 `AgentGroupList.tsx` 引用的 helper），新 helper 与其放在同一文件、保持同样的风格。

### 2. ChannelHeader 加按钮

在 [`ChannelHeader.tsx`](../../../apps/client/src/components/channel/ChannelHeader.tsx)：

- 该组件已计算出 `associatedAgent`（L69-72）：`otherUser?.userType === "bot"` 时取 `otherUser`，否则取 `members` 里第一个 bot 成员的 user。这对 `direct`（bot DM）和 `topic-session`（成员里有 bot）都成立。
- 新增判断：
  ```ts
  const isOneOnOneAgentChat =
    (channel.type === "topic-session" || channel.type === "direct") &&
    associatedAgent?.userType === "bot";
  ```
  > 注意：刻意排除 `routine-session`、`echo`。
- 引入 `useNavigate`（`@tanstack/react-router`）与 `SquarePen`（`lucide-react`）。
- 在右侧按钮区（L319 的 `<div className="flex items-center gap-1">`）渲染按钮 —— 这是独立于现有 `!isDirect` 那组的渲染条件，所以在 bot DM 下也会显示：

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

  - 文案复用已存在的 i18n key `navigation:newTopic`（`AgentGroupList.tsx` L216-223 已在用，defaultValue `"新建话题"`）。`ChannelHeader` 目前 `useTranslation("channel")`，需要改成 `useTranslation(["channel", "navigation"])` 或在调用处显式带 `ns`。
  - 图标 `SquarePen` 与侧边栏一致；尺寸取 `18`（与该区其它 `size="icon"` 按钮如 `Info` 一致）。

- 按钮放在该区第一个还是最后一个位置由实现时按视觉权衡决定（建议放在最前，紧邻标题侧）。

### 3. 数据来源确认（实现时验证）

- `ChannelHeader` 仅接收 `channel` 和 `currentUserRole`。`members` 在 `channel.type !== "direct" && channel.type !== "echo"` 时已被拉取，故 `topic-session` 能拿到 bot 成员 → `associatedAgent` 有值。
- `direct` bot DM 的 `associatedAgent` 来自 `channelWithUnread.otherUser`。
- 不为此功能新增任何额外网络请求。

## 测试

- `apps/client/src/components/channel/__tests__/ChannelHeader.test.tsx`（若不存在则新建）：
  - `topic-session` + bot 成员 → 渲染"新建 topic"按钮；点击触发 `navigate({ to: "/channels", search: { agentId } })`（mock `useNavigate`）。
  - `direct` + 对端是 bot → 渲染按钮。
  - `direct` + 对端是普通 user → 不渲染。
  - `routine-session` + bot → 不渲染。
  - `public` / `private` → 不渲染。
- `agentTopics.ts` 的单元测试：`navigateToNewTopic` 用正确参数调用传入的 `navigate`。
- `AgentGroupList.test.tsx` 若已有覆盖 `handleNewTopic` 的用例，确认改用 helper 后仍通过。

## 风险 / 备注

- `ChannelHeader` 改 `useTranslation` 的 namespace 数组时，注意不要破坏现有 `channel` namespace 的用法。
- `navigateToNewTopic` 的 `navigate` 类型如果在项目里不好标注（TanStack Router 的 `useNavigate` 返回类型较复杂），可退化为 `navigate: (opts: { to: "/channels"; search: { agentId: string } }) => unknown` 这种窄签名，或直接复用项目里 `navigateToChannel` 已采用的标注方式。
