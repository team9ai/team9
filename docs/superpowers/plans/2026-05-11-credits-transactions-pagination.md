# Credits 交易记录分页 + 详情弹窗 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Workspace Credits 页面的交易记录加真分页（翻看全部历史）、给每行加一个打开「交易详情」弹窗的 Details 按钮、并删掉始终为空的 Amount 列。

**Architecture:** 三层改动 —— (1) billing-hub 外部仓库的 integration 端点 `GET /api/billing/account/transactions` 增加 `page`/`offset` + 返回 `total`；(2) team9 gateway 新增 `BillingHubService.getWorkspaceTransactionsPage` + 新 controller 端点 `GET /v1/workspaces/:id/billing/transactions`（沿用 owner/admin 角色门禁）；(3) 前端新增 api 方法 + React Query hook，改造 `SubscriptionContent.tsx` 的 "Recent Transactions" 区块（去掉 Amount 列、加上一页/下一页、加 Details 弹窗）。`getWorkspaceOverview` 的 `recentTransactions` 字段保持不变（首屏第 1 页 10 条），翻页才走新端点。

**Tech Stack:** billing-hub: Hono + Drizzle + Vitest（integration 测试需要测试 Postgres + Redis 起着）。team9 gateway: NestJS + Jest（纯单元，mock fetch）。前端: React 19 + TanStack Query v5 + shadcn/ui（Dialog 已存在）。

---

## 仓库路径约定

- billing-hub 外部仓库根目录：`/Users/jiangtao/Desktop/shenjingyuan/billing-hub`
- team9 仓库根目录：`/Users/jiangtao/Desktop/shenjingyuan/team9`（即当前工作目录）

billing-hub 是**独立的 git 仓库**，对它的提交用 `git -C /Users/jiangtao/Desktop/shenjingyuan/billing-hub ...`。team9 的提交在当前目录正常提交。

---

## File Structure

| 文件                                                                                | 改动 | 责任                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `billing-hub/server/src/routes/integration.ts`                                      | 修改 | `recentTransactionsQuerySchema` 加 `page`；`GET /account/transactions` handler 改成 offset 分页 + 返回 `{ transactions, total, page, limit, totalPages }`                                                                                   |
| `billing-hub/server/test/integration/account-read.spec.ts`                          | 修改 | `getTransactions` 测试 helper 加 `page` 参数；新增分页断言用例                                                                                                                                                                              |
| `team9/apps/server/apps/gateway/src/billing-hub/billing-hub.service.ts`             | 修改 | 新增 `WorkspaceBillingTransactionsPage` 接口 + `getWorkspaceTransactionsPage()` 方法（含 owner/admin 门禁）                                                                                                                                 |
| `team9/apps/server/apps/gateway/src/billing-hub/billing-hub.service.spec.ts`        | 修改 | 新增 `getWorkspaceTransactionsPage` 的单测                                                                                                                                                                                                  |
| `team9/apps/server/apps/gateway/src/workspace/workspace-billing.controller.ts`      | 修改 | 新增 `GET :workspaceId/billing/transactions` 端点（AuthGuard + WorkspaceGuard，从 `request.workspaceRole` 取角色，page/limit 钳制）                                                                                                         |
| `team9/apps/server/apps/gateway/src/workspace/workspace-billing.controller.spec.ts` | 修改 | 新增端点的单测（转发 page/limit/role、钳制、无 owner/admin 元数据）                                                                                                                                                                         |
| `team9/apps/client/src/types/workspace.ts`                                          | 修改 | 新增 `WorkspaceBillingTransactionsPage` 接口                                                                                                                                                                                                |
| `team9/apps/client/src/services/api/workspace.ts`                                   | 修改 | 新增 `getBillingTransactions(workspaceId, page, limit)`                                                                                                                                                                                     |
| `team9/apps/client/src/hooks/useWorkspaceBilling.ts`                                | 修改 | 新增 `useWorkspaceBillingTransactions(workspaceId, page, enabled)` hook                                                                                                                                                                     |
| `team9/apps/client/src/components/layout/contents/SubscriptionContent.tsx`          | 修改 | 改造 "Recent Transactions" 区块：去 Amount 列、加分页控件、加 Details 弹窗；删除现已不用的 `getTransactionAmountLabel` / `getTransactionMeta` 两个 helper；新增 `formatTransactionType` / `TransactionDetailRow` / `CopyButton` 三个 helper |

---

## Task 1: billing-hub — `GET /api/billing/account/transactions` 加分页

**Files:**

- Modify: `/Users/jiangtao/Desktop/shenjingyuan/billing-hub/server/src/routes/integration.ts`
- Test: `/Users/jiangtao/Desktop/shenjingyuan/billing-hub/server/test/integration/account-read.spec.ts`

> **前置条件**：integration 测试需要测试用 Postgres 和 Redis 起着（仓库里通常有 docker-compose 或 `pnpm` 脚本拉起）。如果本地没起，跑 `pnpm --dir server test` 会失败在 `test/helpers/setup.js`。

- [ ] **Step 1: 改测试 helper `getTransactions` 让它支持 `page`**

文件 `server/test/integration/account-read.spec.ts`，把现有的：

```ts
async function getTransactions(ownerExternalId: string, limit = 10) {
  return app.request(
    withQuery("/api/billing/account/transactions", {
      ownerExternalId,
      limit,
    }),
    {
      headers: { "X-Service-Key": SERVICE_KEY },
    },
  );
}
```

改成：

```ts
async function getTransactions(ownerExternalId: string, limit = 10, page = 1) {
  return app.request(
    withQuery("/api/billing/account/transactions", {
      ownerExternalId,
      limit,
      page,
    }),
    {
      headers: { "X-Service-Key": SERVICE_KEY },
    },
  );
}
```

- [ ] **Step 2: 写失败测试**

在 `server/test/integration/account-read.spec.ts` 的 `describe("GET /api/billing/account/transactions", () => { ... })` 块**末尾**（在它的 `});` 之前）追加两个用例：

```ts
it("paginates transactions and reports total/page/limit", async () => {
  const account = await createTestAccount({
    ownerExternalId: "tenant:workspace-paginated",
    ownerType: "organization",
    balance: 0,
  });

  for (let i = 0; i < 3; i += 1) {
    await recharge({
      ownerExternalId: account.ownerExternalId,
      amountUSD: 5,
      referenceType: "stripe_checkout",
      referenceId: `cs_pack_${i}`,
      description: `Pack ${i}`,
    });
  }

  const firstPage = await getTransactions(account.ownerExternalId, 2, 1);
  expect(firstPage.status).toBe(200);
  const firstBody = await firstPage.json();
  expect(firstBody.success).toBe(true);
  expect(firstBody.data.total).toBe(3);
  expect(firstBody.data.page).toBe(1);
  expect(firstBody.data.limit).toBe(2);
  expect(firstBody.data.totalPages).toBe(2);
  expect(firstBody.data.transactions).toHaveLength(2);

  const secondPage = await getTransactions(account.ownerExternalId, 2, 2);
  const secondBody = await secondPage.json();
  expect(secondBody.data.page).toBe(2);
  expect(secondBody.data.total).toBe(3);
  expect(secondBody.data.transactions).toHaveLength(1);
});

it("returns a zeroed page when no billing account exists", async () => {
  const res = await getTransactions("tenant:workspace-no-account", 10, 1);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data).toMatchObject({
    transactions: [],
    total: 0,
    page: 1,
    limit: 10,
    totalPages: 0,
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

从 `/Users/jiangtao/Desktop/shenjingyuan/billing-hub` 运行：

```bash
pnpm --dir server test -- test/integration/account-read.spec.ts
```

Expected: 新增的两个用例 FAIL（`firstBody.data.total` 是 `undefined`，且 `transactions` 长度可能是 3 而非 2，因为现在只有 `limit` 没有 `page`/offset）。

- [ ] **Step 4: 实现分页**

文件 `server/src/routes/integration.ts`：

(a) 把顶部的 drizzle 导入从 `import { eq } from "drizzle-orm";` 改成：

```ts
import { count, desc, eq } from "drizzle-orm";
```

(b) 把 `recentTransactionsQuerySchema` 从：

```ts
const recentTransactionsQuerySchema = z.object({
  ownerExternalId: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
```

改成：

```ts
const recentTransactionsQuerySchema = z.object({
  ownerExternalId: z.string().min(1),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
```

(c) 把 `integrationRoutes.get("/account/transactions", ...)` 整个 handler 替换成：

```ts
integrationRoutes.get("/account/transactions", async (c) => {
  const query = recentTransactionsQuerySchema.safeParse(c.req.query());
  if (!query.success) {
    return error(
      c,
      "VALIDATION_ERROR",
      "Validation failed",
      400,
      query.error.issues,
    );
  }

  const { ownerExternalId, page, limit } = query.data;

  const account =
    await getAccountService().findByOwnerExternalId(ownerExternalId);

  if (!account) {
    return success(c, {
      transactions: [],
      total: 0,
      page,
      limit,
      totalPages: 0,
    });
  }

  const db = getDb();
  const where = eq(transactions.accountId, account.id);

  const [items, [{ total }]] = await Promise.all([
    db
      .select()
      .from(transactions)
      .where(where)
      .orderBy(desc(transactions.createdAt))
      .limit(limit)
      .offset((page - 1) * limit),
    db.select({ total: count() }).from(transactions).where(where),
  ]);

  return success(c, {
    transactions: items.map((item) => serializeOwnerTransaction(item)),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
});
```

> 注：`serializeOwnerTransaction` / `getAccountService` / `getDb` / `transactions` 都已在该文件中导入/定义，不需要新增。保留 `transactions` 字段名是为了向后兼容现有调用方（team9 的 `listWorkspaceTransactions` 读的就是 `response.transactions`）。

- [ ] **Step 5: 跑测试确认通过**

```bash
pnpm --dir server test -- test/integration/account-read.spec.ts
```

Expected: PASS（含原有的 "returns recent transactions with normalized billing fields" 和 "returns an empty list when no billing account exists yet" —— 它们读的还是 `body.data.transactions`，仍然成立）。

- [ ] **Step 6: 提交（billing-hub 仓库）**

```bash
git -C /Users/jiangtao/Desktop/shenjingyuan/billing-hub add server/src/routes/integration.ts server/test/integration/account-read.spec.ts
git -C /Users/jiangtao/Desktop/shenjingyuan/billing-hub commit -m "feat(integration): paginate account transactions endpoint"
```

---

## Task 2: team9 gateway — `BillingHubService.getWorkspaceTransactionsPage`

**Files:**

- Modify: `/Users/jiangtao/Desktop/shenjingyuan/team9/apps/server/apps/gateway/src/billing-hub/billing-hub.service.ts`
- Test: `/Users/jiangtao/Desktop/shenjingyuan/team9/apps/server/apps/gateway/src/billing-hub/billing-hub.service.spec.ts`

- [ ] **Step 1: 写失败测试**

在 `billing-hub.service.spec.ts` 文件**最外层 `describe('BillingHubService', () => { ... })` 的内部、最后一个 `});` 之前**追加：

```ts
describe("getWorkspaceTransactionsPage", () => {
  const workspaceId = "72ecfcd7-d495-43a4-8b8a-8fda2d9cec14";

  it("fetches the requested page with page+limit query params for managers", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            success: true,
            data: {
              transactions: [
                {
                  id: "txn_9",
                  accountId: "acct_1",
                  type: "charge",
                  amount: -50,
                  balanceBefore: 300,
                  balanceAfter: 250,
                  operatorExternalId: null,
                  agentId: "agent_1",
                  referenceType: "message",
                  referenceId: "msg_9",
                  description: "LLM usage",
                  createdAt: "2026-04-02T00:00:00.000Z",
                  productName: null,
                  paymentAmountCents: null,
                  invoiceId: null,
                },
              ],
              total: 21,
              page: 2,
              limit: 10,
              totalPages: 3,
            },
          }),
        ),
    });

    const result = await service.getWorkspaceTransactionsPage(
      workspaceId,
      2,
      10,
      "owner",
    );

    expect(result).toEqual({
      transactions: [expect.objectContaining({ id: "txn_9" })],
      total: 21,
      page: 2,
      limit: 10,
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://billing.example.com/api/billing/account/transactions?ownerExternalId=tenant%3A72ecfcd7-d495-43a4-8b8a-8fda2d9cec14&page=2&limit=10",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns an empty page without calling Billing Hub for non-managers", async () => {
    const result = await service.getWorkspaceTransactionsPage(
      workspaceId,
      1,
      10,
      "member",
    );
    expect(result).toEqual({
      transactions: [],
      total: 0,
      page: 1,
      limit: 10,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns an empty page when no role is provided", async () => {
    const result = await service.getWorkspaceTransactionsPage(
      workspaceId,
      1,
      10,
    );
    expect(result).toEqual({
      transactions: [],
      total: 0,
      page: 1,
      limit: 10,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

从 `/Users/jiangtao/Desktop/shenjingyuan/team9` 运行：

```bash
pnpm --filter @team9/gateway test -- billing-hub.service.spec
```

Expected: FAIL —— `service.getWorkspaceTransactionsPage is not a function`。

- [ ] **Step 3: 实现 `getWorkspaceTransactionsPage`**

文件 `apps/server/apps/gateway/src/billing-hub/billing-hub.service.ts`：

(a) 在 `WorkspaceBillingOverview` 接口下面新增一个接口：

```ts
export interface WorkspaceBillingTransactionsPage {
  transactions: WorkspaceBillingTransaction[];
  total: number;
  page: number;
  limit: number;
}
```

(b) 在 `listWorkspaceTransactions(...)` 方法**之后**（`getWorkspaceOverview` 之前）新增方法：

```ts
  async getWorkspaceTransactionsPage(
    workspaceId: string,
    page = 1,
    limit = 10,
    role?: WorkspaceRole,
  ): Promise<WorkspaceBillingTransactionsPage> {
    const canView = role === 'owner' || role === 'admin';
    if (!this.enabled || !canView) {
      return { transactions: [], total: 0, page, limit };
    }

    const ownerExternalId = encodeURIComponent(
      this.ownerExternalId(workspaceId),
    );

    const response = await this.request<{
      transactions: WorkspaceBillingTransaction[];
      total: number;
      page: number;
      limit: number;
    }>(
      `/api/billing/account/transactions?ownerExternalId=${ownerExternalId}&page=${page}&limit=${limit}`,
      { method: 'GET' },
    );

    return {
      transactions: response.transactions,
      total: response.total,
      page: response.page,
      limit: response.limit,
    };
  }
```

> 注：`listWorkspaceTransactions` 和 `getWorkspaceOverview` 不动 —— billing-hub 现在返回的 `{ transactions, total, ... }` 里仍有 `transactions` 字段，老方法读它依然成立。

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm --filter @team9/gateway test -- billing-hub.service.spec
```

Expected: PASS（含原有的 `getWorkspaceOverview` 那组用例 —— 它们用的是 `installOverviewFetchMock`，返回 `{ transactions: [...] }`，不受影响）。

- [ ] **Step 5: 提交**

```bash
git add apps/server/apps/gateway/src/billing-hub/billing-hub.service.ts apps/server/apps/gateway/src/billing-hub/billing-hub.service.spec.ts
git commit -m "feat(gateway): add getWorkspaceTransactionsPage to BillingHubService"
```

---

## Task 3: team9 gateway — 新增 `GET :workspaceId/billing/transactions` 端点

**Files:**

- Modify: `/Users/jiangtao/Desktop/shenjingyuan/team9/apps/server/apps/gateway/src/workspace/workspace-billing.controller.ts`
- Test: `/Users/jiangtao/Desktop/shenjingyuan/team9/apps/server/apps/gateway/src/workspace/workspace-billing.controller.spec.ts`

- [ ] **Step 1: 写失败测试**

文件 `workspace-billing.controller.spec.ts`：

(a) 把 `billingHubService` 的类型声明和 mock 都加上 `getWorkspaceTransactionsPage`。声明从：

```ts
let billingHubService: {
  listSubscriptionProducts: jest.Mock<any>;
  getWorkspaceSubscription: jest.Mock<any>;
  getWorkspaceOverview: jest.Mock<any>;
  createWorkspaceCheckout: jest.Mock<any>;
  createWorkspacePortal: jest.Mock<any>;
};
```

改成：

```ts
let billingHubService: {
  listSubscriptionProducts: jest.Mock<any>;
  getWorkspaceSubscription: jest.Mock<any>;
  getWorkspaceOverview: jest.Mock<any>;
  getWorkspaceTransactionsPage: jest.Mock<any>;
  createWorkspaceCheckout: jest.Mock<any>;
  createWorkspacePortal: jest.Mock<any>;
};
```

并在 `beforeEach` 的 `billingHubService = { ... }` 对象里，`getWorkspaceOverview` 之后加一行：

```ts
      getWorkspaceTransactionsPage: jest.fn<any>().mockResolvedValue({
        transactions: [],
        total: 0,
        page: 1,
        limit: 10,
      }),
```

(b) 在文件最后 `});` 之前追加三个用例：

```ts
it("forwards page, limit, and role to BillingHubService for transactions", async () => {
  await controller.getTransactions(
    "72ecfcd7-d495-43a4-8b8a-8fda2d9cec14",
    "2",
    "25",
    { workspaceRole: "owner" },
  );
  expect(
    billingHubService.getWorkspaceTransactionsPage,
  ).toHaveBeenLastCalledWith(
    "72ecfcd7-d495-43a4-8b8a-8fda2d9cec14",
    2,
    25,
    "owner",
  );
});

it("clamps bad page/limit query input to safe defaults", async () => {
  await controller.getTransactions(
    "72ecfcd7-d495-43a4-8b8a-8fda2d9cec14",
    "0",
    "500",
    { workspaceRole: "owner" },
  );
  expect(
    billingHubService.getWorkspaceTransactionsPage,
  ).toHaveBeenLastCalledWith(
    "72ecfcd7-d495-43a4-8b8a-8fda2d9cec14",
    1,
    50,
    "owner",
  );

  await controller.getTransactions(
    "72ecfcd7-d495-43a4-8b8a-8fda2d9cec14",
    undefined,
    undefined,
    { workspaceRole: "owner" },
  );
  expect(
    billingHubService.getWorkspaceTransactionsPage,
  ).toHaveBeenLastCalledWith(
    "72ecfcd7-d495-43a4-8b8a-8fda2d9cec14",
    1,
    10,
    "owner",
  );
});

it("does not gate transaction reads behind owner/admin metadata", () => {
  expect(
    Reflect.getMetadata(
      WORKSPACE_ROLES_KEY,
      WorkspaceBillingController.prototype.getTransactions,
    ),
  ).toBeUndefined();
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @team9/gateway test -- workspace-billing.controller.spec
```

Expected: FAIL —— `controller.getTransactions is not a function`。

- [ ] **Step 3: 实现端点**

文件 `apps/server/apps/gateway/src/workspace/workspace-billing.controller.ts`：

(a) 把 `@nestjs/common` 的导入加上 `Query`：

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
```

(b) 在文件顶部（`@Controller` 装饰器之前）新增一个钳制 helper：

```ts
function clampQueryInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Math.trunc(Number(raw));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}
```

(c) 在 `getOverview` 方法**之后**、`createCheckout` 之前新增方法：

```ts
  @Get(':workspaceId/billing/transactions')
  @UseGuards(AuthGuard, WorkspaceGuard)
  async getTransactions(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query('page') pageRaw: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Req() request: { workspaceRole?: string },
  ) {
    const page = clampQueryInt(pageRaw, 1, 1, Number.MAX_SAFE_INTEGER);
    const limit = clampQueryInt(limitRaw, 10, 1, 50);

    return this.billingHubService.getWorkspaceTransactionsPage(
      workspaceId,
      page,
      limit,
      request.workspaceRole as
        | 'owner'
        | 'admin'
        | 'member'
        | 'guest'
        | undefined,
    );
  }
```

> 端点用 `AuthGuard + WorkspaceGuard`（和 `getOverview` 一样，**不**用 `WorkspaceRoleGuard`）—— 角色门禁在 `BillingHubService.getWorkspaceTransactionsPage` 里做（非 owner/admin 返回空页），这样非管理员请求不会 403 而是拿到空列表，和 overview 行为一致。

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm --filter @team9/gateway test -- workspace-billing.controller.spec
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/server/apps/gateway/src/workspace/workspace-billing.controller.ts apps/server/apps/gateway/src/workspace/workspace-billing.controller.spec.ts
git commit -m "feat(gateway): add workspace billing transactions endpoint"
```

---

## Task 4: 前端 — 类型 + api 方法 + hook

**Files:**

- Modify: `/Users/jiangtao/Desktop/shenjingyuan/team9/apps/client/src/types/workspace.ts`
- Modify: `/Users/jiangtao/Desktop/shenjingyuan/team9/apps/client/src/services/api/workspace.ts`
- Modify: `/Users/jiangtao/Desktop/shenjingyuan/team9/apps/client/src/hooks/useWorkspaceBilling.ts`

（前端无组件测试基础设施，这部分不写单测；最终在 Task 7 用 typecheck/build 验证。）

- [ ] **Step 1: 新增类型**

文件 `apps/client/src/types/workspace.ts`，在 `WorkspaceBillingOverview` 接口**之后**新增：

```ts
export interface WorkspaceBillingTransactionsPage {
  transactions: WorkspaceBillingTransaction[];
  total: number;
  page: number;
  limit: number;
}
```

- [ ] **Step 2: 新增 api 方法**

文件 `apps/client/src/services/api/workspace.ts`：

(a) 在文件顶部的 `import type { ... } from "..."` 里，把 `WorkspaceBillingOverview` 那一组类型导入加上 `WorkspaceBillingTransactionsPage`（找到现有 `WorkspaceBillingOverview` 出现在 import 列表的那一行，在同一个 import 块里加入 `WorkspaceBillingTransactionsPage`）。

(b) 在 `getBillingOverview` 方法之后新增：

```ts
  getBillingTransactions: async (
    workspaceId: string,
    page = 1,
    limit = 10,
  ): Promise<WorkspaceBillingTransactionsPage> => {
    const response = await http.get<WorkspaceBillingTransactionsPage>(
      `/v1/workspaces/${workspaceId}/billing/transactions`,
      { params: { page, limit } },
    );
    return response.data;
  },
```

- [ ] **Step 3: 新增 hook**

文件 `apps/client/src/hooks/useWorkspaceBilling.ts`：

(a) 把第一行导入改成（加入 `keepPreviousData`）：

```ts
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
```

(b) 在 `useWorkspaceBillingOverview` 之后新增：

```ts
export function useWorkspaceBillingTransactions(
  workspaceId: string | undefined,
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: ["workspace-billing-transactions", workspaceId, page],
    queryFn: () => workspaceApi.getBillingTransactions(workspaceId!, page),
    enabled: enabled && !!workspaceId,
    placeholderData: keepPreviousData,
  });
}
```

- [ ] **Step 4: typecheck（局部确认）**

从 `/Users/jiangtao/Desktop/shenjingyuan/team9` 运行：

```bash
pnpm --filter @team9/client exec tsc --noEmit
```

Expected: 没有新增类型错误（如果仓库基线本就有报错，确认报错条数/内容不因本次改动而增加）。

- [ ] **Step 5: 提交**

```bash
git add apps/client/src/types/workspace.ts apps/client/src/services/api/workspace.ts apps/client/src/hooks/useWorkspaceBilling.ts
git commit -m "feat(client): add billing transactions page api + hook"
```

---

## Task 5: 前端 — `SubscriptionContent.tsx` 改造交易表格（去 Amount 列 + 分页）

**Files:**

- Modify: `/Users/jiangtao/Desktop/shenjingyuan/team9/apps/client/src/components/layout/contents/SubscriptionContent.tsx`

- [ ] **Step 1: 更新 import**

(a) 第一行：

```ts
import { useEffect, useRef, useState } from "react";
```

改成：

```ts
import { useEffect, useRef, useState, type ReactNode } from "react";
```

(b) lucide 导入：

```ts
import { ShieldAlert } from "lucide-react";
```

改成：

```ts
import { Copy, ShieldAlert } from "lucide-react";
```

(c) 在 `import { Card, CardContent, CardTitle } from "@/components/ui/card";` 之后新增：

```ts
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
```

(d) hooks 导入块：

```ts
import {
  useCreateWorkspaceBillingCheckout,
  useCreateWorkspaceBillingPortal,
  useWorkspaceBillingOverview,
} from "@/hooks/useWorkspaceBilling";
```

改成：

```ts
import {
  useCreateWorkspaceBillingCheckout,
  useCreateWorkspaceBillingPortal,
  useWorkspaceBillingOverview,
  useWorkspaceBillingTransactions,
} from "@/hooks/useWorkspaceBilling";
```

- [ ] **Step 2: 删掉两个不再使用的 helper**

文件里有这两个函数（在 `getTransactionTitle` 前后），整段删除：

```ts
function getTransactionAmountLabel(transaction: WorkspaceBillingTransaction) {
  if (transaction.paymentAmountCents !== null) {
    return formatMoney(transaction.paymentAmountCents);
  }

  if (transaction.type === "quota_grant") {
    return "Included";
  }

  return "—";
}
```

```ts
function getTransactionMeta(transaction: WorkspaceBillingTransaction) {
  if (transaction.invoiceId) {
    return `Invoice ${transaction.invoiceId}`;
  }

  if (transaction.referenceId) {
    return `Reference ${transaction.referenceId}`;
  }

  return formatStatusLabel(transaction.type);
}
```

（`getTransactionTitle` 保留；`formatMoney`、`formatStatusLabel` 仍被别处使用，保留。）

- [ ] **Step 3: 新增三个 helper（Task 6 的弹窗也会用）**

在 `getTransactionTitle` 函数**之后**新增：

```ts
function formatTransactionType(type: string) {
  const labels: Record<string, string> = {
    charge: "Usage charge",
    quota_grant: "Subscription quota",
    signup_bonus: "Signup bonus",
    recharge: "Top-up",
    refund: "Refund",
    adjustment: "Manual adjustment",
  };
  return labels[type] ?? formatStatusLabel(type);
}

function TransactionDetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <dt className="w-28 shrink-0 text-xs uppercase tracking-[0.16em] text-[#7e91b2]">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-[#1f2c47]">{children}</dd>
    </div>
  );
}

function TransactionReferenceCopyButton({ value }: { value: string }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-5 w-5 shrink-0 text-[#7e91b2] hover:text-[#35517d]"
      aria-label="Copy reference ID"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
      }}
    >
      <Copy className="h-3.5 w-3.5" />
    </Button>
  );
}
```

- [ ] **Step 4: 在组件里新增 state 和 hook 调用**

找到组件内这三行（约在 `const overview = useWorkspaceBillingOverview(workspaceId);` 附近）：

```ts
const overview = useWorkspaceBillingOverview(workspaceId);
const checkout = useCreateWorkspaceBillingCheckout(workspaceId);
const portal = useCreateWorkspaceBillingPortal(workspaceId);
```

在它们**下面**紧接着新增：

```ts
const [transactionsPage, setTransactionsPage] = useState(1);
const [selectedTransaction, setSelectedTransaction] =
  useState<WorkspaceBillingTransaction | null>(null);
const transactionsQuery = useWorkspaceBillingTransactions(
  workspaceId,
  transactionsPage,
  currentView === "credits",
);
const transactions = transactionsQuery.data?.transactions ?? [];
const transactionsTotal = transactionsQuery.data?.total ?? 0;
const transactionsLimit = transactionsQuery.data?.limit ?? 10;
const transactionsTotalPages = Math.max(
  1,
  Math.ceil(transactionsTotal / transactionsLimit),
);

useEffect(() => {
  setTransactionsPage(1);
}, [workspaceId]);
```

> `currentView` 已在组件里定义（`const currentView: BillingView = view === "credits" ? "credits" : "plans";`），且这些 hook 调用都在组件早期、任何条件 `return` 之前 —— 符合 hooks 规则。

- [ ] **Step 5: 替换 "Recent Transactions" 区块**

找到 `<div id="credits-history">...</div>` 整块（`<Card>` 标题是 "Recent Transactions" 的那块），整段替换为：

```tsx
<div id="credits-history">
  <Card className="overflow-hidden rounded-[1.35rem] border-white/70 bg-white/75 shadow-[0_24px_72px_-44px_rgba(15,23,42,0.35)] backdrop-blur">
    <CardContent className="p-5 sm:p-6">
      <CardTitle className="text-lg font-semibold tracking-[-0.02em] text-[#111b35]">
        Recent Transactions
      </CardTitle>

      <div className="mt-5">
        {transactionsQuery.isLoading ? (
          <SectionMessage
            title="Loading transactions…"
            description="Fetching the latest billing activity for this workspace."
          />
        ) : transactionsQuery.isError ? (
          <SectionMessage
            title="Couldn't load transactions"
            description={getErrorMessage(
              transactionsQuery.error,
              "Please try again in a moment.",
            )}
          />
        ) : transactionsTotal === 0 ? (
          <SectionMessage
            title="No billing transactions yet"
            description="Completed recharges, subscriptions, and refunds will appear here."
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-[#d5dfef] bg-white">
              <div className="hidden grid-cols-[1.6fr_0.8fr_auto] gap-4 border-b border-[#e8edf5] bg-[#f0f4fb] px-5 py-3 text-[11px] font-medium uppercase tracking-[0.2em] text-[#7e91b2] md:grid">
                <div>Date</div>
                <div>Credits</div>
                <div className="text-right">Actions</div>
              </div>

              {transactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="grid gap-3 border-t border-[#e8edf5] px-5 py-3.5 first:border-t-0 md:grid-cols-[1.6fr_0.8fr_auto] md:items-center"
                >
                  <div>
                    <MobileTableLabel>Date</MobileTableLabel>
                    <div className="text-sm font-medium text-[#111b35]">
                      {formatDateTime(transaction.createdAt)}
                    </div>
                    <div className="mt-1 text-xs text-[#7e91b2]">
                      {getTransactionTitle(transaction)}
                    </div>
                  </div>

                  <div>
                    <MobileTableLabel>Credits</MobileTableLabel>
                    <div className="text-sm font-medium text-[#425675]">
                      {formatCredits(transaction.amount)}
                    </div>
                  </div>

                  <div className="md:text-right">
                    <MobileTableLabel>Actions</MobileTableLabel>
                    <Button
                      variant="link"
                      className="h-auto p-0 text-sm font-medium text-[#35517d] hover:text-[#111b35]"
                      onClick={() => setSelectedTransaction(transaction)}
                    >
                      Details
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setTransactionsPage((page) => Math.max(1, page - 1))
                }
                disabled={transactionsPage <= 1 || transactionsQuery.isFetching}
              >
                Previous
              </Button>
              <span className="text-xs text-[#7e91b2]">
                Page {transactionsPage} of {transactionsTotalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setTransactionsPage((page) =>
                    Math.min(transactionsTotalPages, page + 1),
                  )
                }
                disabled={
                  transactionsPage >= transactionsTotalPages ||
                  transactionsQuery.isFetching
                }
              >
                Next
              </Button>
            </div>
          </>
        )}
      </div>
    </CardContent>
  </Card>
</div>
```

> 注：`canOpenInvoice` 变量（约在 `if (currentView === "credits") {` 块顶部）和它对应的 `{portal.error && canOpenInvoice ? (...) : null}` 错误块**保持不动** —— 它们仍然读 `overview.data?.recentTransactions`，作为 portal 报错的兜底展示位置；本次不动它们以缩小改动面。

- [ ] **Step 6: typecheck**

```bash
pnpm --filter @team9/client exec tsc --noEmit
```

Expected: 没有新增类型错误。（这一步可能会因为 Task 6 还没加弹窗、`selectedTransaction` 只 set 不读而提示 unused —— 如果 tsc 配了 `noUnusedLocals` 报错，就先把 Task 6 一起做完再 typecheck；否则本步通过即可。）

- [ ] **Step 7: 提交**

```bash
git add apps/client/src/components/layout/contents/SubscriptionContent.tsx
git commit -m "feat(client): paginate credits transactions list, drop amount column"
```

---

## Task 6: 前端 — `SubscriptionContent.tsx` 加「交易详情」弹窗

**Files:**

- Modify: `/Users/jiangtao/Desktop/shenjingyuan/team9/apps/client/src/components/layout/contents/SubscriptionContent.tsx`

- [ ] **Step 1: 在 credits 视图里渲染弹窗**

在 Task 5 替换后的 `<div id="credits-history">...</div>` 块的**正下方**（同一个父容器内、紧跟其后）新增：

```tsx
<Dialog
  open={!!selectedTransaction}
  onOpenChange={(open) => {
    if (!open) {
      setSelectedTransaction(null);
    }
  }}
>
  <DialogContent className="sm:max-w-md">
    {selectedTransaction ? (
      <>
        <DialogHeader>
          <DialogTitle>{getTransactionTitle(selectedTransaction)}</DialogTitle>
          <DialogDescription>
            {formatTransactionType(selectedTransaction.type)}
          </DialogDescription>
        </DialogHeader>

        <dl className="mt-2 space-y-3 text-sm">
          <TransactionDetailRow label="Time">
            {formatDateTime(selectedTransaction.createdAt)}
          </TransactionDetailRow>
          <TransactionDetailRow label="Credits">
            {formatCredits(selectedTransaction.amount)}
          </TransactionDetailRow>
          <TransactionDetailRow label="Balance">
            {formatCredits(selectedTransaction.balanceBefore)} →{" "}
            {formatCredits(selectedTransaction.balanceAfter)}
          </TransactionDetailRow>
          {selectedTransaction.description ? (
            <TransactionDetailRow label="Description">
              {selectedTransaction.description}
            </TransactionDetailRow>
          ) : null}
          {selectedTransaction.referenceType ||
          selectedTransaction.referenceId ? (
            <TransactionDetailRow label="Reference">
              <span className="flex items-center gap-1.5">
                <span className="break-all">
                  {[
                    selectedTransaction.referenceType
                      ? formatStatusLabel(selectedTransaction.referenceType)
                      : null,
                    selectedTransaction.referenceId,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {selectedTransaction.referenceId ? (
                  <TransactionReferenceCopyButton
                    value={selectedTransaction.referenceId}
                  />
                ) : null}
              </span>
            </TransactionDetailRow>
          ) : null}
          {selectedTransaction.agentId ? (
            <TransactionDetailRow label="Agent">
              {selectedTransaction.agentId}
            </TransactionDetailRow>
          ) : null}
          {selectedTransaction.operatorExternalId ? (
            <TransactionDetailRow label="Operator">
              {selectedTransaction.operatorExternalId}
            </TransactionDetailRow>
          ) : null}
          {selectedTransaction.paymentAmountCents !== null ? (
            <TransactionDetailRow label="Payment">
              {formatMoney(selectedTransaction.paymentAmountCents)}
            </TransactionDetailRow>
          ) : null}
          {selectedTransaction.invoiceId ? (
            <TransactionDetailRow label="Invoice">
              {selectedTransaction.invoiceId}
            </TransactionDetailRow>
          ) : null}
        </dl>

        {selectedTransaction.invoiceId ||
        selectedTransaction.paymentAmountCents !== null ? (
          <DialogFooter className="mt-4 flex-col items-stretch gap-2 sm:flex-col sm:items-stretch">
            <Button
              variant="outline"
              onClick={() => void handleManageBilling("credits")}
              disabled={portal.isPending}
            >
              Get invoice
            </Button>
            {portal.error ? (
              <p className="text-xs text-destructive">
                {getErrorMessage(
                  portal.error,
                  "Couldn't open the billing portal. Please try again.",
                )}
              </p>
            ) : null}
          </DialogFooter>
        ) : null}
      </>
    ) : null}
  </DialogContent>
</Dialog>
```

> `handleManageBilling` / `getErrorMessage` / `formatMoney` / `formatCredits` / `formatDateTime` / `formatStatusLabel` 都已存在于该文件。

- [ ] **Step 2: typecheck**

```bash
pnpm --filter @team9/client exec tsc --noEmit
```

Expected: 没有新增类型错误。

- [ ] **Step 3: lint（自动修可修的）**

```bash
pnpm --filter @team9/client exec eslint --fix src/components/layout/contents/SubscriptionContent.tsx src/hooks/useWorkspaceBilling.ts src/services/api/workspace.ts src/types/workspace.ts
```

Expected: 无 error（warning 可接受，与基线一致）。

- [ ] **Step 4: 提交**

```bash
git add apps/client/src/components/layout/contents/SubscriptionContent.tsx
git commit -m "feat(client): add transaction details dialog to workspace credits"
```

---

## Task 7: 端到端验证 + 手动冒烟

**Files:** 无（仅运行验证命令）

- [ ] **Step 1: billing-hub 单测全跑（该文件）**

```bash
pnpm --dir server test -- test/integration/account-read.spec.ts
```

（在 `/Users/jiangtao/Desktop/shenjingyuan/billing-hub` 下，需测试 Postgres+Redis 起着。）
Expected: PASS。

- [ ] **Step 2: team9 gateway 相关单测全跑**

```bash
pnpm --filter @team9/gateway test -- billing-hub
pnpm --filter @team9/gateway test -- workspace-billing
```

Expected: PASS。

- [ ] **Step 3: team9 前端 typecheck**

```bash
pnpm --filter @team9/client exec tsc --noEmit
```

Expected: 无新增错误。

- [ ] **Step 4: team9 前端 build（确保打包不挂）**

```bash
pnpm build:client
```

Expected: 成功（如基线本就有 warning，与基线一致即可）。

- [ ] **Step 5: 手动冒烟（需本地起 server + client + billing-hub）**

1. `pnpm dev`（team9）+ billing-hub 起着。
2. 用一个 owner 身份打开 `/subscription?view=credits&workspaceId=<id>`。
3. 检查 "Recent Transactions"：表格列是 Date / Credits / Actions（**没有 Amount**）；底部有 Previous / Next + "Page 1 of N"。
4. 点 Next → 列表换到第 2 页，按钮在边界页正确禁用；翻页时旧行短暂保留不闪。
5. 点某行 "Details" → 弹窗打开，展示 Time / Credits / Balance / Description / Reference（带复制按钮）/ Agent / Operator / Payment / Invoice（缺失字段不显示）。
6. 对一笔有发票的交易，弹窗里出现 "Get invoice" 按钮，点击跳转 Stripe portal。
7. 用一个 member 身份打开同页 → "Recent Transactions" 显示 "No billing transactions yet"（total=0，不报错）。

- [ ] **Step 6: 收尾提交（如手动冒烟中有微调）**

```bash
git add -A
git commit -m "chore: polish credits transactions pagination after smoke test"
```

（若无改动则跳过此步。）

---

## Self-Review 备注（写计划者已核对）

- **Spec 覆盖**：分页（Task 1+2+3+4+5）、Details 弹窗（Task 6）、删 Amount 列（Task 5 Step 5）、owner/admin 门禁（Task 2 Step 3 + Task 3 Step 3）、overview 首屏前 10 条不动（Task 2 注释明确不改 `getWorkspaceOverview`）、每页 10 条（hook 默认 limit=10、controller 默认 10）、上一页/下一页（Task 5 Step 5）—— 全覆盖。
- **类型一致性**：`WorkspaceBillingTransactionsPage` 在 server（`billing-hub.service.ts`）和 client（`types/workspace.ts`）各定义一份，字段一致（`transactions/total/page/limit`，无 `totalPages` —— billing-hub 返回的 `totalPages` 在 service 层被丢弃，前端用 `Math.ceil(total/limit)` 自己算）；`getWorkspaceTransactionsPage(workspaceId, page, limit, role?)` 在 service、controller、两处 spec 中签名一致；新 hook `useWorkspaceBillingTransactions(workspaceId, page, enabled?)` 在定义和调用处一致。
- **无 placeholder**：所有代码步骤均给出完整代码块。
