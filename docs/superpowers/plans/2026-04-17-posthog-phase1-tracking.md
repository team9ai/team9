# PostHog Phase 1 前端埋点 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 PostHog 第一期 10 个前端事件，覆盖 homepage 曝光、注册链路、onboarding 链路、Plan 页面和订阅按钮点击，打通 team9-homepage 与 team9 客户端的 distinct_id。

**Architecture:** 两个独立仓库（`team9-homepage` Next.js + `team9` Tauri/React）直连同一个 PostHog project，通过 `cross_subdomain_cookie` 打通跨域 distinct_id；关键转化节点同步推 `window.dataLayer`，GTM 侧可接广告平台。

**Tech Stack:** `posthog-js`（两仓库同一版本）、Next.js 16 App Router、React 19、TanStack Router、NestJS + Drizzle（后端）。

**Related spec:** [docs/superpowers/specs/2026-04-17-posthog-phase1-tracking-design.md](../specs/2026-04-17-posthog-phase1-tracking-design.md)

---

## 文件改动地图

### team9 后端（NestJS）

- Modify: `apps/server/apps/gateway/src/auth/auth.service.ts` — 3 个鉴权方法返回 `isNewUser`
- Modify: `apps/server/apps/gateway/src/auth/auth.service.spec.ts` — 更新测试期望
- Modify: `apps/server/libs/auth` 或 auth service 内部 `AuthResponse` 类型定义 — 加 `isNewUser: boolean`

### team9 客户端 — 分析层基建

- Create: `apps/client/src/analytics/posthog/events.ts`
- Create: `apps/client/src/analytics/posthog/capture.ts`
- Create: `apps/client/src/analytics/posthog/acquisition.ts`
- Modify: `apps/client/src/analytics/posthog/provider.tsx` — 挂载时调用 acquisition
- Modify: `apps/client/src/analytics/posthog/hooks.ts` — 暴露新 capture 工具（可选）

### team9 客户端 — 业务埋点

- Modify: `apps/client/src/hooks/useAuth.ts` — mutation 类型加 `isNewUser`
- Modify: `apps/client/src/routes/login.tsx` — 3 个 signup 事件 + 删除老 `sign_up_completed`
- Modify: `apps/client/src/routes/_authenticated/onboarding.tsx` — `onboarding_step_viewed` + `onboarding_completed` + Step6 的 subscription 事件
- Modify: `apps/client/src/routes/_authenticated/subscription.tsx` — `source` URL 参数
- Modify: `apps/client/src/components/layout/contents/SubscriptionContent.tsx` — 2 个订阅事件
- Modify: `apps/client/src/components/layout/contents/HomeMainContent.tsx` — 跳转时带 `source`

### team9-homepage（Next.js）

- Modify: `team9-homepage/package.json` — 加 `posthog-js`
- Modify: `team9-homepage/utils/env.ts` — 导出 POSTHOG_KEY/HOST
- Modify: `team9-homepage/.example.env` — 示例 env
- Create: `team9-homepage/utils/analytics/posthog-client.ts`
- Create: `team9-homepage/utils/analytics/provider.tsx`
- Create: `team9-homepage/utils/analytics/capture.ts`
- Create: `team9-homepage/utils/analytics/acquisition.ts`
- Create: `team9-homepage/utils/analytics/events.ts`
- Modify: `team9-homepage/components/AppShell.tsx` — 挂 Provider
- Modify: `team9-homepage/components/HomePage.tsx` — 抽出 CTA 客户端组件
- Create: `team9-homepage/components/home/HomeViewTracker.tsx`
- Create: `team9-homepage/components/home/HeaderCTAGroup.tsx`
- Create: `team9-homepage/components/home/HeroCTAGroup.tsx`
- Create: `team9-homepage/components/home/FooterCTAGroup.tsx`
- Modify: `team9-homepage/components/DownloadButton.tsx` — 加 capture

### 不会改动

- 现有 team9 客户端 `apps/client/src/analytics/posthog/client.ts` / `config.ts` / `sync.tsx`
- 任何后端 im/workspace 模块

---

## Task 1：后端 `AuthResponse` 增加 `isNewUser`

**PR 目标**：让客户端能区分"新用户注册完成"和"老用户登录"。Additive 改动，老客户端忽略新字段。

**Files:**

- Modify: `apps/server/apps/gateway/src/auth/auth.service.ts`
- Modify: `apps/server/apps/gateway/src/auth/auth.service.spec.ts`

- [ ] **Step 1.1：`AuthResponse` 类型定义位置**

`AuthResponse` 定义在 `apps/server/apps/gateway/src/auth/auth.service.ts:42`，形式为：

```ts
export interface AuthResponse extends TokenPair {
  user: { ... };
}
```

需要在这个 interface 里加字段 `isNewUser: boolean`。

- [ ] **Step 1.2：更新 `auth.service.spec.ts` 先加失败测试**

在 `describe('verifyCode')` 块里加一个新测试（放到现有 `it('新用户完成注册')` 类似用例后面）：

```ts
it("returns isNewUser=true for new user signup via email verification", async () => {
  // existing setup for a fresh email that completes signup...
  const result = await service.verifyCode({
    email: "fresh@test.com",
    challengeId,
    code: "123456",
  });
  expect(result.isNewUser).toBe(true);
});

it("returns isNewUser=false for existing user login via email", async () => {
  // existing setup for an existing user...
  const result = await service.verifyCode({
    email: "alice@test.com",
    challengeId,
    code: "123456",
  });
  expect(result.isNewUser).toBe(false);
});
```

在 `describe('googleLogin')` 块里加两个对应的用例（新注册 vs 老登录）。

- [ ] **Step 1.3：运行测试确认失败**

```bash
cd apps/server && pnpm test --testPathPattern=auth.service.spec
```

预期：新增的 4 个 `isNewUser` 断言全部失败（返回对象里没有 `isNewUser` 字段）。

- [ ] **Step 1.4：修改 `AuthResponse` 类型**

在 `auth.service.ts` 找到 `AuthResponse` 定义（或对应 dto 文件），加字段：

```ts
export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: {
    id: string;
    email: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  };
  isNewUser: boolean;
}
```

- [ ] **Step 1.5：`completeSignup()` 返回 `isNewUser: true`，race 分支返回 `false`**

找到 `completeSignup()` 方法（约 L1164），修改两个 return：

```ts
// race condition branch (existing user found)
return {
  ...tokens,
  user: { ... },
  isNewUser: false,  // existing user, not a true signup
};

// fresh insert branch
return {
  ...tokens,
  user: { ... },
  isNewUser: true,
};
```

- [ ] **Step 1.6：`verifyCode()` 老用户分支返回 `isNewUser: false`**

找到 `verifyCode()` 方法（约 L1066）中老用户登录分支的 return（不走 `completeSignup` 的那个），加 `isNewUser: false`。

- [ ] **Step 1.7：`googleLogin()` 按插入分支返回对应值**

找到 `googleLogin()` 方法（约 L585）。它有两个分支：

- 插入新用户分支（约 L660 附近 `await this.db.insert(schema.users)...returning()`）：返回 `isNewUser: true`
- 老用户命中分支：返回 `isNewUser: false`

- [ ] **Step 1.8：运行测试确认通过**

```bash
cd apps/server && pnpm test --testPathPattern=auth.service.spec
```

预期：所有测试通过。

- [ ] **Step 1.9：类型检查**

```bash
cd apps/server && pnpm run build
```

预期：无类型错误。

- [ ] **Step 1.10：Commit**

```bash
git add apps/server/apps/gateway/src/auth/
git commit -m "feat(auth): add isNewUser flag to AuthResponse"
```

---

## Task 2：team9 客户端 — 分析层基建

**PR 目标**：新增 `events.ts` / `capture.ts` / `acquisition.ts`，不触发任何新业务事件，只为 Task 3-5 打基础。

**Files:**

- Create: `apps/client/src/analytics/posthog/events.ts`
- Create: `apps/client/src/analytics/posthog/capture.ts`
- Create: `apps/client/src/analytics/posthog/acquisition.ts`
- Modify: `apps/client/src/analytics/posthog/provider.tsx`

- [ ] **Step 2.1：创建 `events.ts`**

```ts
// apps/client/src/analytics/posthog/events.ts

export const EVENTS = {
  SIGNUP_PAGE_VIEWED: "signup_page_viewed",
  SIGNUP_BUTTON_CLICKED: "signup_button_clicked",
  SIGNUP_COMPLETED: "signup_completed",
  ONBOARDING_STEP_VIEWED: "onboarding_step_viewed",
  ONBOARDING_COMPLETED: "onboarding_completed",
  SUBSCRIPTION_PLAN_PAGE_VIEWED: "subscription_plan_page_viewed",
  SUBSCRIPTION_BUTTON_CLICKED: "subscription_button_clicked",
} as const;

export const ONBOARDING_STEPS = {
  1: "role",
  2: "tasks",
  3: "channels",
  4: "agents",
  5: "invite",
  6: "plan",
} as const;

export type OnboardingStepName =
  (typeof ONBOARDING_STEPS)[keyof typeof ONBOARDING_STEPS];

export type SubscriptionEntrySource = "home" | "onboarding" | "manage_credits";

export type SignupMethod = "email" | "google" | "apple";

// Events that should also be pushed to window.dataLayer for GTM → ad platforms.
// Keys are PostHog event names, values are GTM-facing event names.
export const GTM_BRIDGE_EVENTS: Record<string, string> = {
  [EVENTS.SIGNUP_COMPLETED]: "conversion_signup_completed",
};
```

- [ ] **Step 2.2：创建 `capture.ts`**

```ts
// apps/client/src/analytics/posthog/capture.ts
import type { PostHog } from "posthog-js";
import { GTM_BRIDGE_EVENTS } from "./events";

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

/**
 * Capture an event to PostHog and mirror selected conversion events to
 * window.dataLayer so GTM can forward them to ad platforms.
 */
export function captureWithBridge(
  client: PostHog | null,
  event: string,
  properties?: Record<string, unknown>,
): void {
  client?.capture(event, properties);

  const gtmEvent = GTM_BRIDGE_EVENTS[event];
  if (gtmEvent && typeof window !== "undefined") {
    window.dataLayer = window.dataLayer ?? [];
    window.dataLayer.push({ event: gtmEvent, ...properties });
  }
}
```

- [ ] **Step 2.3：创建 `acquisition.ts`**

```ts
// apps/client/src/analytics/posthog/acquisition.ts
import type { PostHog } from "posthog-js";

const UTM_PARAMS = [
  ["utm_source", "acquisition_source"],
  ["utm_medium", "acquisition_medium"],
  ["utm_campaign", "acquisition_campaign"],
  ["utm_content", "acquisition_content"],
  ["utm_term", "acquisition_term"],
] as const;

/**
 * Capture UTM parameters from the current URL and persist them to the
 * PostHog person as $set_once (i.e. first-touch attribution).
 *
 * Safe to call on every app start — PostHog de-dupes via $set_once.
 * On Tauri desktop URL has no UTM params; this is a no-op.
 */
export function captureAcquisitionOnce(client: PostHog): void {
  if (typeof window === "undefined") return;

  const search = new URLSearchParams(window.location.search);
  const setOnce: Record<string, string> = {};

  for (const [urlKey, propKey] of UTM_PARAMS) {
    const value = search.get(urlKey);
    if (value) {
      setOnce[propKey] = value;
    }
  }

  if (Object.keys(setOnce).length > 0) {
    client.setPersonProperties(undefined, setOnce);
  }
}
```

- [ ] **Step 2.4：`provider.tsx` 挂载时调用 `captureAcquisitionOnce`**

编辑 `apps/client/src/analytics/posthog/provider.tsx`，在 `useEffect` 拿到 `resolvedClient` 后调用：

```ts
// existing imports
import { captureAcquisitionOnce } from "./acquisition";

// inside the useEffect that resolves the client:
void getPostHogBrowserClient().then((resolvedClient) => {
  if (isMounted) {
    setClient(resolvedClient);
    if (resolvedClient) {
      captureAcquisitionOnce(resolvedClient);
    }
  }
});
```

- [ ] **Step 2.5：TypeScript 类型检查**

```bash
cd apps/client && pnpm typecheck
```

预期：无错误。

- [ ] **Step 2.6：Lint**

```bash
cd apps/client && pnpm lint
```

预期：无错误。

- [ ] **Step 2.7：Commit**

```bash
git add apps/client/src/analytics/posthog/
git commit -m "feat(analytics): add events/capture/acquisition modules for PostHog phase 1"
```

---

## Task 3：team9 客户端 — signup 事件

**PR 目标**：在统一登录/注册页埋 3 个 signup 事件。依赖 Task 1（isNewUser 字段）和 Task 2（capture 工具）。

**Files:**

- Modify: `apps/client/src/hooks/useAuth.ts`
- Modify: `apps/client/src/routes/login.tsx`

- [ ] **Step 3.1：`AuthResponse` 客户端镜像类型加 `isNewUser`**

客户端 `AuthResponse` 定义在 `apps/client/src/services/api/index.ts:47`。在这个 interface 末尾加：

```ts
export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user: { ... };
  isNewUser: boolean;  // ADD THIS
}
```

`useVerifyCode` / `useGoogleAuth` / `useAuthStart` 等 mutation 的返回类型都基于这个 `AuthResponse`，不用单独改。

- [ ] **Step 3.2：`login.tsx` 顶部导入新工具**

在现有 imports 后加：

```ts
import { useTeam9PostHog } from "@/analytics/posthog/provider";
import { captureWithBridge } from "@/analytics/posthog/capture";
import { EVENTS } from "@/analytics/posthog/events";
```

- [ ] **Step 3.3：在 `WebLoginView` 顶部拿 posthog client**

在现有 hooks 之后：

```ts
const { client: phClient } = useTeam9PostHog();
```

- [ ] **Step 3.4：`signup_page_viewed` — 组件挂载单次触发**

在 `WebLoginView` 内部加一个 `useEffect`（放在其他 useEffect 附近）：

```ts
const pageViewFiredRef = useRef(false);
useEffect(() => {
  if (pageViewFiredRef.current) return;
  pageViewFiredRef.current = true;
  captureWithBridge(phClient, EVENTS.SIGNUP_PAGE_VIEWED, {
    page_key: "signup",
  });
}, [phClient]);
```

注意：需要 `phClient` 就绪后才能捕获（但现有 `captureWithBridge` 在 `client=null` 时静默，所以实际行为是：如果 client 晚于组件挂载才就绪，我们错过 `signup_page_viewed` 一次。为保险起见，依赖数组包含 `phClient`，当它从 null 变为非 null 时重新触发；`ref` 防止重复）。

- [ ] **Step 3.5：`signup_button_clicked` — Email 流触发点**

在 `handleEmailSubmit` 的开头（`setError("")` 之前）加：

```ts
captureWithBridge(phClient, EVENTS.SIGNUP_BUTTON_CLICKED, {
  signup_method: "email",
});
```

- [ ] **Step 3.6：`signup_button_clicked` — Google 流触发点**

在 `handleGoogleSuccess` 的开头（`setError("")` 之前）加：

```ts
captureWithBridge(phClient, EVENTS.SIGNUP_BUTTON_CLICKED, {
  signup_method: "google",
});
```

- [ ] **Step 3.7：删除老 `sign_up_completed` 手动 capture 块**

在 `navigateAfterAuth` 函数里（当前 L458-468），删除这一段：

```ts
// DELETE THIS BLOCK (lines ~458-468)
try {
  const { default: posthog } = await import("posthog-js");
  if (posthog.__loaded) {
    posthog.capture("sign_up_completed", {
      method: authMethodRef.current,
      has_invite: !!invite,
      is_desktop_flow: !!desktopSessionId,
    });
  }
} catch {
  // Analytics should never block auth flow
}
```

- [ ] **Step 3.8：`signup_completed` — 基于 `isNewUser` 触发**

`navigateAfterAuth` 没法直接拿到 mutation 的 response。改成在 `handleEmailSubmit`、`handleGoogleSuccess`、以及自动验证 `useEffect`（三处 `verifyCode.mutateAsync` / `googleAuth.mutateAsync` 之后）用返回值：

在 `handleEmailSubmit` 里（`verifyCode.mutateAsync` 实际是在 `useEffect` 里调用的，和 `handleCodeSubmit` 里也有一处）：

找到 `handleCodeSubmit`（约 L612-631）：

```ts
const handleCodeSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setError("");

  if (!challengeId) return;

  try {
    postAuthRedirectMode.current = "home";
    setAuthState("verifying_code");
    const authResponse = await verifyCode.mutateAsync({
      email,
      challengeId,
      code,
    });
    if (authResponse.isNewUser) {
      captureWithBridge(phClient, EVENTS.SIGNUP_COMPLETED, {
        signup_method: "email",
      });
    }
    await navigateAfterAuth();
  } catch (err: unknown) {
    setAuthState("code_sent");
    setError(getErrorMessage(err, t("verificationFailed")));
  }
};
```

找到自动验证的 `useEffect`（约 L518-557 的 `doVerify`），类似修改：拿到 `verifyCode.mutateAsync` 返回值后按 `isNewUser` 触发。

找到 `handleGoogleSuccess`（约 L651-673）：

```ts
const result = await googleAuth.mutateAsync({
  credential: credentialResponse.credential,
  signupSource: invite ? "invite" : "self",
});
if (result.isNewUser) {
  captureWithBridge(phClient, EVENTS.SIGNUP_COMPLETED, {
    signup_method: "google",
  });
}
await navigateAfterAuth();
```

- [ ] **Step 3.9：TypeScript / Lint 检查**

```bash
cd apps/client && pnpm typecheck && pnpm lint
```

预期：无错误。

- [ ] **Step 3.10：手动验证**

```bash
pnpm dev:client
```

在浏览器打开 `http://localhost:5173/login`，打开 DevTools Console（dev 模式 PostHog debug 开启），验证：

1. 页面加载时 Console 有 `[PostHog] capture signup_page_viewed` 日志
2. 输入邮箱点击"Continue with Email" → Console 有 `signup_button_clicked` with `signup_method: email`
3. 完成验证码（新邮箱） → Console 有 `signup_completed` with `signup_method: email`，且 `window.dataLayer` 能看到 `conversion_signup_completed`
4. 用已注册邮箱登录 → **不应该**有 `signup_completed` 事件

- [ ] **Step 3.11：Commit**

```bash
git add apps/client/src/routes/login.tsx apps/client/src/hooks/useAuth.ts
git commit -m "feat(analytics): track signup_page_viewed/button_clicked/completed on login route"
```

---

## Task 4：team9 客户端 — onboarding 事件

**PR 目标**：新增 `onboarding_step_viewed` 和 `onboarding_completed`；保留原有 `onboarding_step_completed`。

**Files:**

- Modify: `apps/client/src/routes/_authenticated/onboarding.tsx`

- [ ] **Step 4.1：导入新工具**

在现有 imports 后加：

```ts
import { captureWithBridge } from "@/analytics/posthog/capture";
import { EVENTS, ONBOARDING_STEPS } from "@/analytics/posthog/events";
```

保留 `import { usePostHogAnalytics } from "@/analytics/posthog/hooks";`——现有 `capture` 用于 `onboarding_step_completed` 和 `member_invited`，继续沿用。

- [ ] **Step 4.2：拿到 posthog client**

现有代码有 `const { capture } = usePostHogAnalytics();`。在它旁边再加：

```ts
const { client: phClient } = useTeam9PostHog();
```

并在 import 区加 `import { useTeam9PostHog } from "@/analytics/posthog/provider";`。

- [ ] **Step 4.3：`onboarding_step_viewed` — 监听 currentStep**

在已有 useEffect 附近加：

```ts
const lastViewedStepRef = useRef<number | null>(null);
useEffect(() => {
  if (!workspaceId) return;
  if (lastViewedStepRef.current === currentStep) return;
  lastViewedStepRef.current = currentStep;

  const stepName =
    ONBOARDING_STEPS[currentStep as keyof typeof ONBOARDING_STEPS];
  if (!stepName) return;

  captureWithBridge(phClient, EVENTS.ONBOARDING_STEP_VIEWED, {
    step_name: stepName,
    step_index: currentStep,
    workspace_id: workspaceId,
  });
}, [phClient, workspaceId, currentStep]);
```

- [ ] **Step 4.4：Step 6 额外触发 `subscription_plan_page_viewed`**

在上一个 useEffect 的同一个块里，或者新增一个 useEffect（更清晰）：

```ts
const planPageViewFiredRef = useRef(false);
useEffect(() => {
  if (currentStep !== 6) {
    planPageViewFiredRef.current = false;
    return;
  }
  if (planPageViewFiredRef.current) return;
  planPageViewFiredRef.current = true;

  captureWithBridge(phClient, EVENTS.SUBSCRIPTION_PLAN_PAGE_VIEWED, {
    entry_source: "onboarding",
    workspace_id: workspaceId,
  });
}, [phClient, workspaceId, currentStep]);
```

- [ ] **Step 4.5：`onboarding_completed` — 在 complete 成功路径里触发**

找到 `handleAdvance`（或 `retryProvisioning` 里）调用 `completeOnboarding.mutateAsync` 的位置（约 L725-740）：

```ts
const result = await completeOnboarding.mutateAsync({ lang: language });
queryClient.setQueryData(["workspace-onboarding", workspaceId], result);

if (result.status === "failed") {
  setPageError(t("errors.provisionFailed"));
  return;
}

// ADD THIS
if (result.status === "provisioned") {
  captureWithBridge(phClient, EVENTS.ONBOARDING_COMPLETED, {
    workspace_id: workspaceId,
  });
}
```

同样在 `retryProvisioning`（约 L799）的 `if (result.status === "provisioned")` 分支里加同样的触发。

- [ ] **Step 4.6：Step 6 `handleCheckout` 触发 `subscription_button_clicked`**

找到 `handleCheckout`（约 L755-783）。修改为传入 product 的完整信息（已经是 BillingProduct 类型）：

```ts
const handleCheckout = async (product: BillingProduct) => {
  if (!workspaceId) return;

  captureWithBridge(phClient, EVENTS.SUBSCRIPTION_BUTTON_CLICKED, {
    entry_source: "onboarding",
    plan_name: inferPlanName(product), // helper, see Step 4.7
    amount_cents: product.amountCents,
    billing_interval: inferBillingInterval(product),
    credits_amount: product.credits ?? null,
    stripe_price_id: product.stripePriceId,
    button_name: product.name,
    workspace_id: workspaceId,
  });

  // existing code...
};
```

- [ ] **Step 4.7：辅助函数 `inferPlanName` 和 `inferBillingInterval`**

在文件底部加两个小 helper（后续 Task 5 的 SubscriptionContent.tsx 也会用，最好抽到 `analytics/posthog/` 下，但 onboarding 用的是 BillingProduct 类型，最稳妥是在文件内 inline 或新建 `apps/client/src/analytics/posthog/billing.ts`）：

新建 `apps/client/src/analytics/posthog/billing.ts`：

```ts
// apps/client/src/analytics/posthog/billing.ts
import type { BillingProduct } from "@/types/workspace";

/**
 * Derive a stable plan_name slug from a BillingProduct for analytics.
 *
 * Subscription products: uses the product name lowercased and slugified
 * (e.g. "Pro" → "pro", "Team Plus" → "team_plus").
 * One-time credits topup: always returns "credits_topup".
 */
export function inferPlanName(product: BillingProduct): string {
  if (product.type === "one_time") return "credits_topup";
  return product.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Map Stripe interval to the analytics billing_interval enum.
 */
export function inferBillingInterval(
  product: BillingProduct,
): "monthly" | "yearly" | null {
  if (product.type === "one_time") return null;
  if (product.interval === "month") return "monthly";
  if (product.interval === "year") return "yearly";
  return null;
}
```

更新 Step 4.6 的 import：`import { inferPlanName, inferBillingInterval } from "@/analytics/posthog/billing";`。

- [ ] **Step 4.8：TypeScript / Lint**

```bash
cd apps/client && pnpm typecheck && pnpm lint
```

预期：无错误。

- [ ] **Step 4.9：手动验证**

```bash
pnpm dev:client
```

用新 workspace 进入 onboarding：

1. 进入 Step 1 → Console 有 `onboarding_step_viewed` with `step_name: role, step_index: 1`
2. 前进到 Step 2 → 有 `step_name: tasks, step_index: 2`
3. 回退到 Step 1 → **再次触发**一次（因为 currentStep 变了；这是预期行为）
4. 进入 Step 6 → 触发 `onboarding_step_viewed` with `step_name: plan` **并且** `subscription_plan_page_viewed` with `entry_source: onboarding`
5. 点击订阅按钮 → `subscription_button_clicked` with `entry_source: onboarding`
6. 完成 onboarding 跳转到首页时 → `onboarding_completed`

- [ ] **Step 4.10：Commit**

```bash
git add apps/client/src/routes/_authenticated/onboarding.tsx apps/client/src/analytics/posthog/billing.ts
git commit -m "feat(analytics): track onboarding step views and completion"
```

---

## Task 5：team9 客户端 — subscription 页事件 + `source` 参数串联

**PR 目标**：`/subscription` 页两个事件 + 所有入口加 `source` URL 参数。依赖 Task 2（capture）和 Task 4（billing helpers）。

**Files:**

- Modify: `apps/client/src/routes/_authenticated/subscription.tsx`
- Modify: `apps/client/src/components/layout/contents/HomeMainContent.tsx`
- Modify: `apps/client/src/components/layout/contents/SubscriptionContent.tsx`

- [ ] **Step 5.1：`subscription.tsx` — `source` 参数加入 validateSearch**

编辑 `apps/client/src/routes/_authenticated/subscription.tsx`：

```ts
import type { SubscriptionEntrySource } from "@/analytics/posthog/events";

type SubscriptionSearchParams = {
  workspaceId?: string;
  view?: "plans" | "credits";
  source?: SubscriptionEntrySource;
};

const ENTRY_SOURCES: readonly SubscriptionEntrySource[] = [
  "home",
  "onboarding",
  "manage_credits",
] as const;

export const Route = createFileRoute("/_authenticated/subscription")({
  component: SubscriptionRoute,
  validateSearch: (
    search: Record<string, unknown>,
  ): SubscriptionSearchParams => {
    return {
      workspaceId: search.workspaceId as string | undefined,
      view:
        search.view === "credits" || search.view === "plans"
          ? search.view
          : undefined,
      source: ENTRY_SOURCES.includes(search.source as SubscriptionEntrySource)
        ? (search.source as SubscriptionEntrySource)
        : undefined,
    };
  },
});

function SubscriptionRoute() {
  const { workspaceId, view, source } = Route.useSearch();

  return (
    <SubscriptionContent
      workspaceIdFromSearch={workspaceId}
      view={view}
      entrySource={source}
    />
  );
}
```

- [ ] **Step 5.2：`HomeMainContent.tsx` — 跳转时带 `source`**

查找 3 个 `navigate({ to: "/subscription", ... })` 调用（约 L272、L284、L316）：

- L272（Dashboard Header 的订阅套餐 pill，Crown 图标按钮）：`search: { view: "plans", source: "home" }`
- L284（Dashboard Header 的 credits pill，可能标红）：`search: { view: "credits", source: "manage_credits" }`
- L316（`DashboardPlanBadge` 内部的"Upgrade"按钮，在已订阅用户看到的计划徽章上）：`search: { view: "plans", source: "home" }`

- [ ] **Step 5.3：`SubscriptionContent.tsx` — 添加 `entrySource` prop**

找到 `SubscriptionContent` 的 props 定义（约 L45-55）：

```ts
interface SubscriptionContentProps {
  workspaceIdFromSearch?: string;
  view?: "plans" | "credits";
  entrySource?: SubscriptionEntrySource;
}
```

并在顶部 import：

```ts
import { useTeam9PostHog } from "@/analytics/posthog/provider";
import { captureWithBridge } from "@/analytics/posthog/capture";
import {
  EVENTS,
  type SubscriptionEntrySource,
} from "@/analytics/posthog/events";
import {
  inferPlanName,
  inferBillingInterval,
} from "@/analytics/posthog/billing";
```

- [ ] **Step 5.4：`subscription_plan_page_viewed` — useEffect 触发**

在 `SubscriptionContent` 函数内部加：

```ts
const { client: phClient } = useTeam9PostHog();
const effectiveEntrySource: SubscriptionEntrySource =
  entrySource ?? "manage_credits";

const pageViewedFiredRef = useRef<string | null>(null);
useEffect(() => {
  const key = effectiveEntrySource;
  if (pageViewedFiredRef.current === key) return;
  pageViewedFiredRef.current = key;

  captureWithBridge(phClient, EVENTS.SUBSCRIPTION_PLAN_PAGE_VIEWED, {
    entry_source: effectiveEntrySource,
    workspace_id: workspaceId,
  });
}, [phClient, effectiveEntrySource, workspaceId]);
```

- [ ] **Step 5.5：`subscription_button_clicked` — 修改 `handleCheckout`**

找到 `handleCheckout` 定义（约 L338-360）。当前签名是 `handleCheckout(priceId: string, type, view, customAmount?)`。需要拿到完整 product 信息。

**推荐策略**：把 `handleCheckout` 改成接 `{ product, customAmountCents? }`（object 参数），三个调用点（plans、credits 固定档位、credits 自定义）统一传入 product；然后在函数内部打 capture：

```ts
const handleCheckout = async (params: {
  product: BillingProduct;
  customAmountCents?: number;
}) => {
  const { product, customAmountCents } = params;
  const amountCents = customAmountCents ?? product.amountCents;
  const creditsAmount =
    customAmountCents !== undefined
      ? customAmountCents // 1 USD cent = 1 credit? adjust per product metadata
      : (product.credits ?? null);

  captureWithBridge(phClient, EVENTS.SUBSCRIPTION_BUTTON_CLICKED, {
    entry_source: effectiveEntrySource,
    plan_name: inferPlanName(product),
    amount_cents: amountCents,
    billing_interval: inferBillingInterval(product),
    credits_amount: creditsAmount,
    stripe_price_id: product.stripePriceId,
    button_name: product.name,
    workspace_id: workspaceId,
  });

  const response = await checkout.mutateAsync({
    priceId: product.stripePriceId,
    type: product.type ?? "subscription",
    view: product.type === "one_time" ? "credits" : "plans",
    // ... any existing params (customAmountCents, successPath, cancelPath)
  });
  await openExternalUrl(response.checkoutUrl);
};
```

**关于 `credits_amount`**：`SubscriptionContent.tsx:58` 的 `formatCreditsFromCents` 揭示了换算规则：

```ts
function formatCreditsFromCents(amountCents: number) {
  return formatCredits(amountCents * 10);
}
```

即 `credits = amountCents * 10`（1 USD = 1000 credits）。analytics 里直接用 `customAmountCents * 10` 即可（不走 format，需要 raw number）。

最终 `creditsAmount` 表达式：

```ts
const creditsAmount =
  product.type === "one_time" && customAmountCents !== undefined
    ? customAmountCents * 10
    : (product.credits ?? null);
```

- [ ] **Step 5.6：更新 3 个调用点**

- Plans "Choose Plan"（L886-891）：
  ```ts
  onAction: isCurrentPlan
    ? undefined
    : () => {
        void handleCheckout({ product: selectedProduct });
      },
  ```
- Credits 自定义金额"Add Credits"（L554-572）：
  ```ts
  onClick={() => {
    if (!subscription) {
      setShowSubscriptionRequired(true);
      return;
    }
    if (customAmountProduct && customAmountCents !== null) {
      void handleCheckout({
        product: customAmountProduct,
        customAmountCents,
      });
    }
  }}
  ```
- Credits 固定档位按钮（L615-624）：

  ```ts
  onClick={() => void handleCheckout({ product })}
  ```

- [ ] **Step 5.7：TypeScript / Lint**

```bash
cd apps/client && pnpm typecheck && pnpm lint
```

预期：无错误。

- [ ] **Step 5.8：手动验证**

```bash
pnpm dev:client
```

1. 从首页点击升级按钮 → URL 变为 `/subscription?view=plans&source=home` → Console 有 `subscription_plan_page_viewed` with `entry_source: home`
2. 点击任一订阅套餐按钮 → `subscription_button_clicked` with `entry_source: home, plan_name: pro, amount_cents: 4000, billing_interval: monthly, stripe_price_id: price_xxx`
3. 从首页 credits 不足提示进入 → URL `?source=manage_credits` → `entry_source: manage_credits`
4. 直接访问 `/subscription`（无 source 参数） → `entry_source: manage_credits`（fallback）
5. 在 plans ↔ credits tab 之间切换 → **不重复触发** `subscription_plan_page_viewed`（因为 source 不变）
6. 点击 "Add Credits" 自定义金额 → `subscription_button_clicked` with `plan_name: credits_topup, amount_cents: xxx, credits_amount: xxx`

- [ ] **Step 5.9：Commit**

```bash
git add apps/client/src/routes/_authenticated/subscription.tsx apps/client/src/components/layout/contents/HomeMainContent.tsx apps/client/src/components/layout/contents/SubscriptionContent.tsx
git commit -m "feat(analytics): track subscription_plan_page_viewed and subscription_button_clicked with entry_source"
```

---

## Task 6：team9-homepage — 接入 PostHog + 3 个 home 事件

**PR 目标**：在独立的 Next.js 仓库接入 PostHog，实现 `home_viewed` / `home_signup_button_clicked` / `home_download_button_clicked`。

**Files（全部在 `/Users/jiangtao/Desktop/shenjingyuan/team9-homepage/`）:**

- Modify: `package.json`
- Modify: `utils/env.ts`
- Modify: `.example.env`
- Create: `utils/analytics/posthog-client.ts`
- Create: `utils/analytics/provider.tsx`
- Create: `utils/analytics/capture.ts`
- Create: `utils/analytics/acquisition.ts`
- Create: `utils/analytics/events.ts`
- Modify: `components/AppShell.tsx`
- Create: `components/home/HomeViewTracker.tsx`
- Create: `components/home/HeaderCTAGroup.tsx`
- Create: `components/home/HeroCTAGroup.tsx`
- Create: `components/home/FooterCTAGroup.tsx`
- Modify: `components/HomePage.tsx`
- Modify: `components/DownloadButton.tsx`

- [ ] **Step 6.1：切换到 team9-homepage 目录并安装依赖**

```bash
cd /Users/jiangtao/Desktop/shenjingyuan/team9-homepage
pnpm add posthog-js
```

预期：`package.json` 新增 `posthog-js` 依赖，`pnpm-lock.yaml` 更新。

- [ ] **Step 6.2：更新 `utils/env.ts`**

```ts
// utils/env.ts
export const LANDING_BASE_URL =
  process.env.NEXT_PUBLIC_LANDING_BASE_URL || "https://team9.ai";
export const APP_BASE_URL =
  process.env.NEXT_PUBLIC_APP_BASE_URL || "https://app.team9.ai";

// Google Analytics & Tag Manager
export const GA_ID = process.env.NEXT_PUBLIC_GA_ID || "";
export const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID || "";

// PostHog
export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY || "";
export const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";
```

- [ ] **Step 6.3：更新 `.example.env`**

```bash
cat /Users/jiangtao/Desktop/shenjingyuan/team9-homepage/.example.env
```

追加：

```env
# PostHog
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
NEXT_PUBLIC_APP_VERSION=0.1.0
```

- [ ] **Step 6.4：创建 `utils/analytics/events.ts`**

```ts
// utils/analytics/events.ts

export const EVENTS = {
  HOME_VIEWED: "home_viewed",
  HOME_SIGNUP_BUTTON_CLICKED: "home_signup_button_clicked",
  HOME_DOWNLOAD_BUTTON_CLICKED: "home_download_button_clicked",
} as const;

export type ButtonLocation = "header" | "hero" | "footer";

// PostHog event name → GTM/dataLayer event name for ad conversion bridging.
export const GTM_BRIDGE_EVENTS: Record<string, string> = {
  [EVENTS.HOME_SIGNUP_BUTTON_CLICKED]: "conversion_signup_click",
  [EVENTS.HOME_DOWNLOAD_BUTTON_CLICKED]: "conversion_download_click",
};
```

- [ ] **Step 6.5：创建 `utils/analytics/posthog-client.ts`**

```ts
// utils/analytics/posthog-client.ts
"use client";

import type { PostHog } from "posthog-js";
import { POSTHOG_KEY, POSTHOG_HOST, APP_VERSION } from "@/utils/env";

let clientPromise: Promise<PostHog | null> | null = null;

export function getPostHogClient(): Promise<PostHog | null> {
  if (!POSTHOG_KEY) return Promise.resolve(null);
  if (clientPromise) return clientPromise;

  clientPromise = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        defaults: "2026-01-30",
        cross_subdomain_cookie: true,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        capture_dead_clicks: false,
        capture_exceptions: false,
        capture_heatmaps: false,
        disable_external_dependency_loading: true,
        disable_session_recording: true,
        disable_surveys: true,
        advanced_disable_flags: true,
        advanced_disable_toolbar_metrics: true,
        mask_all_element_attributes: true,
        mask_all_text: true,
        debug: process.env.NODE_ENV === "development",
      });

      posthog.register({
        app_name: "team9-homepage",
        app_platform: "homepage",
        app_version: APP_VERSION,
      });

      return posthog;
    })
    .catch((err) => {
      console.error("[PostHog] init failed", err);
      clientPromise = null;
      return null;
    });

  return clientPromise;
}
```

- [ ] **Step 6.6：创建 `utils/analytics/acquisition.ts`**

```ts
// utils/analytics/acquisition.ts
"use client";

import type { PostHog } from "posthog-js";

const UTM_PARAMS = [
  ["utm_source", "acquisition_source"],
  ["utm_medium", "acquisition_medium"],
  ["utm_campaign", "acquisition_campaign"],
  ["utm_content", "acquisition_content"],
  ["utm_term", "acquisition_term"],
] as const;

export function captureAcquisitionOnce(client: PostHog): void {
  if (typeof window === "undefined") return;

  const search = new URLSearchParams(window.location.search);
  const setOnce: Record<string, string> = {};

  for (const [urlKey, propKey] of UTM_PARAMS) {
    const value = search.get(urlKey);
    if (value) setOnce[propKey] = value;
  }

  if (Object.keys(setOnce).length > 0) {
    client.setPersonProperties(undefined, setOnce);
  }
}
```

- [ ] **Step 6.7：创建 `utils/analytics/capture.ts`**

```ts
// utils/analytics/capture.ts
"use client";

import type { PostHog } from "posthog-js";
import { GTM_BRIDGE_EVENTS } from "./events";

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

export function captureWithBridge(
  client: PostHog | null,
  event: string,
  properties?: Record<string, unknown>,
): void {
  client?.capture(event, properties);

  const gtmEvent = GTM_BRIDGE_EVENTS[event];
  if (gtmEvent && typeof window !== "undefined") {
    window.dataLayer = window.dataLayer ?? [];
    window.dataLayer.push({ event: gtmEvent, ...properties });
  }
}
```

- [ ] **Step 6.8：创建 `utils/analytics/provider.tsx`**

```tsx
// utils/analytics/provider.tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { PostHog } from "posthog-js";
import { getPostHogClient } from "./posthog-client";
import { captureAcquisitionOnce } from "./acquisition";

const PostHogContext = createContext<PostHog | null>(null);

export function PostHogProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<PostHog | null>(null);

  useEffect(() => {
    let mounted = true;
    void getPostHogClient().then((resolved) => {
      if (!mounted) return;
      setClient(resolved);
      if (resolved) captureAcquisitionOnce(resolved);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <PostHogContext.Provider value={client}>{children}</PostHogContext.Provider>
  );
}

export function usePostHogClient(): PostHog | null {
  return useContext(PostHogContext);
}
```

- [ ] **Step 6.9：修改 `components/AppShell.tsx` — 挂 Provider**

在现有 imports 下加：

```tsx
import { PostHogProvider } from "@/utils/analytics/provider";
```

在 `<body>` 里包住 `<NextIntlClientProvider>`：

```tsx
<body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
  <PostHogProvider>
    <NextIntlClientProvider messages={messages}>
      {children}
    </NextIntlClientProvider>
  </PostHogProvider>
</body>
```

- [ ] **Step 6.10：创建 `components/home/HomeViewTracker.tsx`**

```tsx
// components/home/HomeViewTracker.tsx
"use client";

import { useEffect, useRef } from "react";
import { usePostHogClient } from "@/utils/analytics/provider";
import { captureWithBridge } from "@/utils/analytics/capture";
import { EVENTS } from "@/utils/analytics/events";

export default function HomeViewTracker() {
  const client = usePostHogClient();
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    if (!client) return;
    firedRef.current = true;
    captureWithBridge(client, EVENTS.HOME_VIEWED, { page_key: "home" });
  }, [client]);

  return null;
}
```

- [ ] **Step 6.11：创建 `components/home/HeaderCTAGroup.tsx`**

```tsx
// components/home/HeaderCTAGroup.tsx
"use client";

import { usePostHogClient } from "@/utils/analytics/provider";
import { captureWithBridge } from "@/utils/analytics/capture";
import { EVENTS } from "@/utils/analytics/events";
import { APP_BASE_URL } from "@/utils/env";

interface Props {
  signInLabel: string;
  signUpLabel: string;
}

export default function HeaderCTAGroup({ signInLabel, signUpLabel }: Props) {
  const client = usePostHogClient();

  return (
    <>
      <a
        href={`${APP_BASE_URL}/login`}
        className="px-4 py-2 md:px-5 md:py-2.5 text-white/70 text-sm md:text-base font-semibold hover:text-white transition-colors duration-200"
      >
        {signInLabel}
      </a>
      <a
        href={APP_BASE_URL}
        onClick={() => {
          captureWithBridge(client, EVENTS.HOME_SIGNUP_BUTTON_CLICKED, {
            button_location: "header",
          });
        }}
        className="px-4 py-2 md:px-5 md:py-2.5 text-sm md:text-base font-semibold rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-400 hover:to-orange-400 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/30"
      >
        {signUpLabel}
      </a>
    </>
  );
}
```

- [ ] **Step 6.12：创建 `components/home/HeroCTAGroup.tsx`**

```tsx
// components/home/HeroCTAGroup.tsx
"use client";

import DownloadButton from "@/components/DownloadButton";
import { usePostHogClient } from "@/utils/analytics/provider";
import { captureWithBridge } from "@/utils/analytics/capture";
import { EVENTS } from "@/utils/analytics/events";
import { APP_BASE_URL } from "@/utils/env";

interface Props {
  downloadLabel: string;
  startForFreeLabel: string;
}

export default function HeroCTAGroup({
  downloadLabel,
  startForFreeLabel,
}: Props) {
  const client = usePostHogClient();

  return (
    <div className="flex flex-row items-center justify-center gap-4">
      <DownloadButton
        label={downloadLabel}
        className="group relative px-9 py-4 md:px-11 md:py-5 bg-gradient-to-r from-amber-600 via-amber-500 to-orange-600 text-white text-base md:text-lg font-bold rounded-xl md:rounded-2xl touch-action-manipulation transition-all duration-150 hover:scale-105 hover:shadow-[0_18px_50px_-14px_rgba(251,191,36,0.55)] active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-500/50 flex items-center gap-2 cursor-pointer"
      />
      <a
        href={APP_BASE_URL}
        onClick={() => {
          captureWithBridge(client, EVENTS.HOME_SIGNUP_BUTTON_CLICKED, {
            button_location: "hero",
          });
        }}
      >
        <button
          aria-label="Open Team9 in your browser"
          className="group relative px-9 py-4 md:px-11 md:py-5 border border-white/20 bg-white/5 backdrop-blur-sm text-white text-base md:text-lg font-bold rounded-xl md:rounded-2xl touch-action-manipulation transition-all duration-150 hover:scale-105 hover:bg-white/10 hover:border-white/30 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30 flex items-center gap-2 cursor-pointer"
        >
          {startForFreeLabel}
        </button>
      </a>
    </div>
  );
}
```

- [ ] **Step 6.13：创建 `components/home/FooterCTAGroup.tsx`**

先查看 HomePage.tsx L1830-1860 原始 footer CTA 代码：

```bash
sed -n '1825,1860p' /Users/jiangtao/Desktop/shenjingyuan/team9-homepage/components/HomePage.tsx
```

然后按原样迁移到 `FooterCTAGroup.tsx`，把 onClick 替换成捕获：

```tsx
// components/home/FooterCTAGroup.tsx
"use client";

import { usePostHogClient } from "@/utils/analytics/provider";
import { captureWithBridge } from "@/utils/analytics/capture";
import { EVENTS } from "@/utils/analytics/events";
import { APP_BASE_URL } from "@/utils/env";

interface Props {
  ctaLabel: string;
}

export default function FooterCTAGroup({ ctaLabel }: Props) {
  const client = usePostHogClient();

  return (
    <button
      aria-label="Get started with Team9"
      onClick={() => {
        captureWithBridge(client, EVENTS.HOME_SIGNUP_BUTTON_CLICKED, {
          button_location: "footer",
        });
        window.location.href = APP_BASE_URL;
      }}
      className="/* copy className from HomePage.tsx footer button */"
    >
      {ctaLabel}
    </button>
  );
}
```

**Important**：按原文件 L1837-1855 的 className 和 SVG icon 完整迁移过来——不要丢 UI 细节。

- [ ] **Step 6.14：修改 `DownloadButton.tsx` — 加 capture**

```tsx
// components/DownloadButton.tsx
"use client";

import { useCallback, useState } from "react";
import { usePostHogClient } from "@/utils/analytics/provider";
import { captureWithBridge } from "@/utils/analytics/capture";
import { EVENTS } from "@/utils/analytics/events";

// ... existing interfaces and detectArch() unchanged

export default function DownloadButton({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  const [loading, setLoading] = useState(false);
  const client = usePostHogClient();

  const handleDownload = useCallback(async () => {
    if (loading) return;
    setLoading(true);

    captureWithBridge(client, EVENTS.HOME_DOWNLOAD_BUTTON_CLICKED, {
      button_location: "hero",
    });

    try {
      // ... existing download logic
    } finally {
      setLoading(false);
    }
  }, [loading, client]);

  // ... existing JSX unchanged
}
```

- [ ] **Step 6.15：修改 `HomePage.tsx` — 用新客户端组件替换原位置**

编辑 `components/HomePage.tsx`：

1. 顶部加 imports：

```ts
import HomeViewTracker from "@/components/home/HomeViewTracker";
import HeaderCTAGroup from "@/components/home/HeaderCTAGroup";
import HeroCTAGroup from "@/components/home/HeroCTAGroup";
import FooterCTAGroup from "@/components/home/FooterCTAGroup";
```

2. 移除原 `import DownloadButton from "@/components/DownloadButton";`（已经被 HeroCTAGroup 内部 import）

3. 在 Return 的最顶层加 `<HomeViewTracker />`（随便放在 root `<div>` 内，位置不重要）

4. 替换 Header 中的 Sign In / Sign Up `<a>` 块（L83-96）为：

```tsx
<LanguageSwitcher locale={locale} />
<HeaderCTAGroup
  signInLabel={tHeader("signIn")}
  signUpLabel={tHeader("signUp")}
/>
```

5. 替换 Hero CTA 块（L133-146 `<DownloadButton>` + `<a href={APP_BASE_URL}>` + `<button>`）为：

```tsx
<HeroCTAGroup
  downloadLabel={tHero("downloadForMac")}
  startForFreeLabel={tHero("startForFree")}
/>
```

6. 替换 Footer CTA 按钮（L1837-1855）为：

```tsx
<FooterCTAGroup ctaLabel={tCta("getStarted")} />
```

需要查找原按钮用的 i18n key 是什么（看 tCta/... namespace）并对应传入。

- [ ] **Step 6.16：构建和类型检查**

```bash
cd /Users/jiangtao/Desktop/shenjingyuan/team9-homepage
pnpm lint
pnpm build
```

预期：构建成功，无类型/lint 错误。

- [ ] **Step 6.17：本地手动验证**

```bash
pnpm dev
```

创建或编辑 `.env.local` 加入 `NEXT_PUBLIC_POSTHOG_KEY=<dev key>`（如果没有 dev key，可以用 PostHog 提供的测试 project key；或留空，那么 capture 会静默跳过，只能验证 dataLayer 桥接）。

浏览器打开 `http://localhost:3000/en`，DevTools Console：

1. 首次加载 → `home_viewed` 事件（PostHog debug 日志；在 PostHog Live events 能看到）
2. 点击 Header "Sign Up" → `home_signup_button_clicked` with `button_location: header`，`window.dataLayer` 里有 `conversion_signup_click`
3. 点击 Hero "Download for Mac" → `home_download_button_clicked` with `button_location: hero`，`dataLayer` 里有 `conversion_download_click`
4. 点击 Hero "Start for Free" → `home_signup_button_clicked` with `button_location: hero`
5. 滚到 Footer 点 "Get started" → `home_signup_button_clicked` with `button_location: footer`
6. 带 `?utm_source=google_ads&utm_medium=cpc` 参数重新访问 → PostHog Person 属性里 `acquisition_source: google_ads`

- [ ] **Step 6.18：Commit**

```bash
cd /Users/jiangtao/Desktop/shenjingyuan/team9-homepage
git add .
git commit -m "feat(analytics): integrate PostHog and track home_viewed / signup_click / download_click"
```

---

## Task 7：跨仓库 E2E 验证

**PR 目标**：验证跨域 distinct_id 打通和完整漏斗。无代码改动，仅人工验证。

- [ ] **Step 7.1：把 team9-homepage 和 team9 客户端都指向同一个 PostHog project**

两个 `.env.local` 文件里 `NEXT_PUBLIC_POSTHOG_KEY` / `VITE_POSTHOG_KEY` 填同一个 key。

- [ ] **Step 7.2：端到端漏斗验证**

1. 带 `?utm_source=test_campaign&utm_medium=referral&utm_campaign=funnel_e2e` 访问 homepage（本地 dev 服务器都起起来：`localhost:3000` 和 `localhost:5173`）
2. 记录浏览器 Cookies 里 PostHog 的 `ph_*_posthog` cookie 值
3. 点击 homepage 的 Sign Up → 跳转到 `localhost:5173`（需要手动跨端口，实际生产是子域）
4. 在 team9 客户端完成注册（用新邮箱触发 `signup_completed`）
5. 进入 onboarding，走完 6 步
6. 在 PostHog Live events 过滤同一个 distinct_id，应看到完整序列：
   - `home_viewed`
   - `home_signup_button_clicked`
   - `signup_page_viewed`
   - `signup_button_clicked`
   - `signup_completed`
   - `onboarding_step_viewed` × 6
   - `subscription_plan_page_viewed`（Step 6 触发）
   - `onboarding_completed`
7. 查 Person 属性，确认 `acquisition_source: test_campaign`

**注意**：本地跨端口无法自动共享 cookie（`localhost:3000` 和 `localhost:5173` 被视为不同 origin）。这一步只能在 staging 环境验证（需 `team9.ai` + `app.team9.ai` 真实子域）。本地 dev 验证改为：人工在浏览器复制一个 distinct_id 到 team9 客户端，或用 `posthog.identify()` 手动 alias。

生产/staging 验证 checklist（部署后必做）：

- [ ] `document.cookie` 在两个子域都能看到 PostHog cookie
- [ ] distinct_id 字符串相同

---

## 自查

### Spec 覆盖核对

每个 spec 章节对应的 task：

- [x] §1 目标范围 → 整个计划
- [x] §2 架构/跨域 → Task 6（homepage 配置 `cross_subdomain_cookie: true`）+ Task 7（E2E）
- [x] §3 公共属性
  - `app_name/platform/version` → Task 2 Step 2.4（client）+ Task 6 Step 6.5（homepage）
  - 身份属性 → 已有 `sync.tsx` 处理，不改
  - UTM 归因 → Task 2 Step 2.3 + Task 6 Step 6.6
  - workspace_id → 已有 `sync.tsx` 的 group，不改
- [x] §4.1 `home_viewed` → Task 6 Step 6.10
- [x] §4.2 `home_signup_button_clicked` → Task 6 Step 6.11/6.12/6.13
- [x] §4.3 `home_download_button_clicked` → Task 6 Step 6.14
- [x] §4.4 `signup_page_viewed` → Task 3 Step 3.4
- [x] §4.5 `signup_button_clicked` → Task 3 Step 3.5/3.6
- [x] §4.6 `signup_completed` → Task 3 Step 3.8（依赖 Task 1 的 `isNewUser`）
- [x] §4.7 `onboarding_step_viewed` → Task 4 Step 4.3
- [x] §4.8 `onboarding_completed` → Task 4 Step 4.5
- [x] §4.9 `subscription_plan_page_viewed` → Task 4 Step 4.4 + Task 5 Step 5.4
- [x] §4.10 `subscription_button_clicked` → Task 4 Step 4.6 + Task 5 Step 5.5
- [x] §5 team9-homepage 实现 → Task 6
- [x] §6.1 后端 isNewUser → Task 1
- [x] §6.2 分析层文件 → Task 2
- [x] §6.3 登录/注册埋点 → Task 3
- [x] §6.4 onboarding 埋点 → Task 4
- [x] §6.5 订阅页埋点 + source 参数 → Task 5
- [x] §6.6 老事件处理 → Task 3 Step 3.7（删 sign_up_completed）
- [x] §7 Rollout → Task 1-6 分 PR，Task 7 做 E2E
- [x] §8 验证 → 每个 Task 最后一步 + Task 7
- [x] §9 配置 checklist → 交给运维/PM，代码侧 Task 6 Step 6.3 给了 `.example.env`

### Placeholder 扫描

- ❓ Task 5 Step 5.2 "L316（其他按钮）：根据 UI 语义选择" — 这是让执行者看代码决定。可以接受，但更严格应在 plan 里定死。标注为 **执行者需现场决定**。
- ❓ Task 5 Step 5.5 `creditsFromCents` helper 可能不存在，需先 grep。Step 已包含 grep 命令和兜底方案。
- ❓ Task 6 Step 6.13 FooterCTAGroup 的 className 需要从 HomePage.tsx 复制——步骤已声明 "按原文件 L1837-1855 的 className 和 SVG icon 完整迁移过来"，执行者知道要怎么做。
- ✅ 无 "TBD" / "TODO" / "fill in details"。
- ✅ 所有代码块是完整可复制的。

### 类型一致性

- `captureWithBridge(client, event, properties)` 签名在 team9 客户端和 team9-homepage 两版完全一致。✅
- `ONBOARDING_STEPS` 的 key 类型是 `1|2|3|4|5|6`，访问时用 `currentStep as keyof typeof ONBOARDING_STEPS`。✅
- `SubscriptionEntrySource` 类型在 `events.ts` 定义，`subscription.tsx` / `SubscriptionContent.tsx` 都 import 同一个。✅
- `inferPlanName` / `inferBillingInterval` 都在 `billing.ts`，两处使用一致。✅
- `isNewUser: boolean` 在后端 `AuthResponse` 和前端 `useAuth.ts` 的 mutation 返回类型里都加了。✅

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-17-posthog-phase1-tracking.md`.

Two execution options:

1. **Subagent-Driven（推荐）** — 每个 Task 派一个 fresh subagent 实现，Task 间我做 review，迭代快
2. **Inline Execution** — 在当前会话直接按 Task 1→2→…→7 顺序执行，Task 间停下来让你 check

Which approach?
