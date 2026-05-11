# Credits 交易记录分页 + 详情弹窗 — 设计

日期：2026-05-11

## 背景

Workspace Credits 页面（路由 `/subscription?view=credits`，组件
[`SubscriptionContent.tsx`](../../../apps/client/src/components/layout/contents/SubscriptionContent.tsx)）的
"Recent Transactions" 区块当前：

- 只显示最近 10 条交易，无分页 / "加载更多"。
- 表格四列：Date / Amount / Credits / Actions。`Amount` 列只对 Stripe
  支付（充值、订阅）有值（`paymentAmountCents`），对 LLM 扣费、grant 等都是 `null`
  显示 `—`，对绝大多数用户始终为空。
- `Actions` 列只显示 "Get invoice" 链接（有发票时）或一段 "Reference gen-xxx"
  纯文本，信息量小。

数据链路：
`useWorkspaceBillingOverview` → `GET /v1/workspaces/:id/billing/overview` →
`BillingHubService.getWorkspaceOverview` → billing-hub
`GET /api/billing/account/transactions?ownerExternalId=...&limit=10`。
billing-hub 的 integration 端点目前只接受 `limit`（最大 50），不支持 offset/page，
不返回总数。

## 目标

1. 给交易记录加真正的分页（可翻看全部历史，不只是最近 50 条）。
2. 每行加一个 `Details` 按钮，点开弹窗展示该交易的全部字段。
3. 删掉 `Amount` 列（支付金额改在 Details 弹窗里展示）。

## 非目标

- 不加按 agent / 类型 / 时间范围的筛选。
- 不改 billing-hub 的 admin 端点。
- 不给前端组件补单测（项目现状前端无组件测试覆盖）。

## 设计

### A. billing-hub（外部仓库 `/Users/jiangtao/Desktop/shenjingyuan/billing-hub`）

修改 integration 路由 `GET /api/billing/account/transactions`
（`server/src/routes/integration.ts`）：

- query schema（`recentTransactionsQuerySchema`）增加 `page`（`z.coerce.number().int().min(1).default(1)`），
  保留 `limit`（默认 10，最大 50）。
- 查询加 `.offset((page - 1) * limit)`；用 `count()` 算 `total`（账户不存在时 `total = 0`）。
  参考 admin 路由（`server/src/routes/admin.ts:212` 附近）已有的 `paginatedResponse` 写法。
- 返回结构从 `{ transactions: [...] }` 改为 `{ transactions: [...], total, page, limit }`
  —— 旧字段名 `transactions` 保留，新增 `total` / `page` / `limit`，向后兼容。
- 加/更新 integration 测试（`server/test/integration/account-read.spec.ts`）覆盖
  page=1 / page=2 / total 正确性 / limit 上限。

### B. team9 gateway

- `BillingHubService.listWorkspaceTransactions(workspaceId, page = 1, limit = 10)`
  （[`billing-hub.service.ts`](../../../apps/server/apps/gateway/src/billing-hub/billing-hub.service.ts)）：
  透传 `page`，返回 `{ transactions, total, page, limit }`。
- 新增 controller 端点
  `GET /v1/workspaces/:workspaceId/billing/transactions?page=&limit=`
  （[`workspace-billing.controller.ts`](../../../apps/server/apps/gateway/src/workspace/workspace-billing.controller.ts)）：
  - 沿用现有的 owner/admin 角色校验逻辑（同
    `getWorkspaceOverview` 里 `canViewTransactions` 的判断）。非管理员返回
    `{ transactions: [], total: 0, page, limit }`。
  - `page` / `limit` 用 DTO 校验（`limit` clamp 到 1..50，默认 10；`page` 最小 1，默认 1）。
- `getWorkspaceOverview` 保持不变：`recentTransactions` 仍返回首屏第 1 页 10 条，
  避免页面初次加载多一次请求。翻页时前端再打新端点。
- 加 service / controller 测试覆盖新端点的角色校验和透传。

### C. 前端 `apps/client`

- [`workspace.ts`](../../../apps/client/src/services/api/workspace.ts)：新增
  `getBillingTransactions(workspaceId, page)` → `GET .../billing/transactions?page=N&limit=10`，
  返回 `{ transactions: WorkspaceBillingTransaction[], total, page, limit }`。
- [`useWorkspaceBilling.ts`](../../../apps/client/src/hooks/useWorkspaceBilling.ts)：新增
  `useWorkspaceBillingTransactions(workspaceId, page)`，React Query，
  `placeholderData: keepPreviousData`（翻页不闪），`enabled` 仅在 credits 视图。
- 类型 [`workspace.ts`](../../../apps/client/src/types/workspace.ts)：新增
  `WorkspaceBillingTransactionsPage { transactions; total; page; limit }`。
- [`SubscriptionContent.tsx`](../../../apps/client/src/components/layout/contents/SubscriptionContent.tsx)
  "Recent Transactions" 区块改造（见下）。

### D. "Recent Transactions" UI

- **表格列**：`Date / Credits / Actions` —— **删掉 Amount 列**（同时删 `getTransactionAmountLabel`
  在表格里的用法、`MobileTableLabel` 的 "Amount"、grid 列模板从 `1.2fr 0.6fr 0.8fr 0.6fr`
  改为 `1.4fr 0.8fr 0.6fr` 之类）。
- **数据源**：用 `useWorkspaceBillingTransactions(workspaceId, page)` 替代
  `overview.data.recentTransactions`。`page` 用组件内 `useState`（初始 1）。
  首屏可直接用 `page=1`，React Query 缓存命中 overview 拉过的同一份数据视情况而定；
  简单起见统一走新 hook。
- **分页控件**：表格底部「上一页 / 下一页」按钮（shadcn `Button variant="outline" size="sm"`）
  - 中间显示 "Page X of Y"（`Y = Math.max(1, Math.ceil(total / limit))`）。
  * 第 1 页禁用「上一页」；最后一页禁用「下一页」。
  * 翻页 loading 时按钮 disabled，`keepPreviousData` 保留当前行。
- **空状态**：`total === 0` 时保持现有 `SectionMessage`（"No billing transactions yet"）。
- **错误处理**：请求失败时表格下方 inline error（沿用页面里现有的 destructive 样式），
  保留当前页已有数据。
- **Actions 列**：每行一个 `Details` 按钮（`Button variant="link"` 或 `outline size="sm"`，
  跟页面现有风格一致），点击打开 shadcn `Dialog`。原 "Get invoice" 链接收进弹窗。

### E. Details 弹窗

shadcn `Dialog`。组件内维护 `selectedTransaction` 状态（点 Details 时 set，
关闭时清空）。内容：

- **标题**：`getTransactionTitle(transaction)`（productName / description / 类型人话化）。
- **字段列表**（key-value，缺失字段不渲染该行）：
  - 时间 — 完整 `createdAt`（本地化 datetime）
  - 类型 — `type` 人话化映射：`charge` → "消费"，`quota_grant` → "订阅额度"，
    `signup_bonus` → "注册赠送"，`recharge` → "充值"，`refund` → "退款"，
    其余 fallback 到 `formatStatusLabel(type)`
  - 积分变动 — `formatCredits(transaction.amount)`（保留正负号）
  - 余额 — `formatCredits(balanceBefore)` → `formatCredits(balanceAfter)`
  - 描述 — `description`（完整，不截断）
  - 来源 — `referenceType` 人话化 + 完整 `referenceId`（带复制按钮）
  - 发起 Agent — `agentId`（有才显示）
  - 操作人 — `operatorExternalId`（有才显示）
  - 支付金额 — `formatMoney(paymentAmountCents)`（有才显示）
  - 发票 — `invoiceId` 文本 + 「Get invoice」按钮（有 `invoiceId` 或 `paymentAmountCents`
    时显示），点击复用现有 `handleManageBilling("credits")` 跳 Stripe portal。
- 所有字段都来自现有 `WorkspaceBillingTransaction` 类型，不需要新数据。

## 数据流

1. 进入 credits 视图 → `useWorkspaceBillingOverview`（余额/套餐/产品 + 首屏交易）
   并行 `useWorkspaceBillingTransactions(workspaceId, 1)`（交易列表，含 total）。
2. 用户点「下一页」→ `page` state +1 → React Query 拉
   `GET /v1/workspaces/:id/billing/transactions?page=2&limit=10` → gateway 角色校验 →
   `BillingHubService.listWorkspaceTransactions(id, 2, 10)` → billing-hub
   `GET /api/billing/account/transactions?ownerExternalId=...&page=2&limit=10` →
   返回 `{ transactions, total, page, limit }`。
3. 用户点某行「Details」→ 打开 Dialog 展示该交易全部字段（纯前端，无额外请求）。

## 测试

- billing-hub：integration 测试 — page=1 / page=2 / total 正确 / limit 上限 clamp。
- team9 gateway：`billing-hub.service.spec.ts` — `listWorkspaceTransactions` 透传 page、
  解析新返回结构；controller 测试 — 新端点的 owner/admin 校验、非管理员返回空+total=0、
  page/limit DTO clamp。
- 前端：不加组件测试；本地跑 `pnpm typecheck` / lint 通过即可。

## 已定的小决策

- 翻页用「上一页 / 下一页」按钮，不用无限滚动（符合设置面板风格）。
- 每页 10 条。
- overview 首屏仍带前 10 条（`recentTransactions` 字段不动）；翻页才走新端点。
