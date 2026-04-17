# PostHog Phase 1 前端埋点 — 设计文档

- 文档日期：2026-04-17
- 阶段：phase_1_frontend_minimal
- 范围：team9-homepage（Next.js）+ team9 客户端（Tauri + React）共 10 个事件

---

## 1. 目标与范围

对齐 PostHog 第一期前端埋点需求，覆盖 **homepage 曝光、注册链路、onboarding 链路、Plan 页曝光、订阅按钮点击** 共 10 个事件，并为未来广告转化（GTM → Google Ads / Meta 等）预留桥接层。

### 10 个事件 × 归属仓库

| 事件                            | 归属仓库       |
| ------------------------------- | -------------- |
| `home_viewed`                   | team9-homepage |
| `home_signup_button_clicked`    | team9-homepage |
| `home_download_button_clicked`  | team9-homepage |
| `signup_page_viewed`            | team9 (客户端) |
| `signup_button_clicked`         | team9 (客户端) |
| `signup_completed`              | team9 (客户端) |
| `onboarding_step_viewed`        | team9 (客户端) |
| `onboarding_completed`          | team9 (客户端) |
| `subscription_plan_page_viewed` | team9 (客户端) |
| `subscription_button_clicked`   | team9 (客户端) |

### 明确不做（range out）

- 后端埋点（本期全部前端）
- PostHog feature flag / session recording / surveys（配置里全部关闭）
- 定义/迁移 PostHog 看板和漏斗（留给数据/PM 团队）
- team9-homepage `/pricing` 页埋点（不在 10 个事件范围）

---

## 2. 架构与跨域身份打通

```
  ┌──────────────────────┐       ┌──────────────────────┐
  │   team9-homepage     │       │   team9 (client)     │
  │   Next.js 16         │       │   Tauri + React      │
  │                      │       │                      │
  │   posthog-js (新装)  │       │   posthog-js (已有)  │
  │        ↓             │       │        ↓             │
  │   3 个 home_* 事件   │       │   7 个业务事件       │
  │        ↓             │       │        ↓             │
  │   dataLayer.push     │       │   dataLayer.push     │
  └──────────┬───────────┘       └──────────┬───────────┘
             ↓                              ↓
      ┌─────────────┐               ┌─────────────┐
      │  PostHog    │←──────────────│    GTM      │
      │  (共用 key) │               │ → Google Ads│
      └─────────────┘               │ → Meta etc. │
                                    └─────────────┘
```

### 跨域 distinct_id 打通

- 两个仓库使用相同的 PostHog project key（web 版本 `NEXT_PUBLIC_POSTHOG_KEY` / `VITE_POSTHOG_KEY`）
- `cross_subdomain_cookie: true`（web 环境；Tauri desktop 下已正确关闭，见现有 `client.ts` 实现）
- 匿名用户在 team9-homepage 活动 → 跳转到 `app.team9.ai` 后 team9 客户端继承同一 distinct_id
- 登录/注册后 `posthog.identify(user.id)`（`sync.tsx` 已实现）→ PostHog 自动合并匿名期事件到真实用户

### 前置条件（运维/PM 侧）

- [ ] team9.ai 与 app.team9.ai 同主域（`.team9.ai` cookie 可跨子域）
- [ ] PostHog project key（`NEXT_PUBLIC_POSTHOG_KEY` / `VITE_POSTHOG_KEY`）在各环境配置到位
- [ ] 确认 PostHog 后台有无基于老事件 `sign_up_completed` 的看板/漏斗（删除前必须确认）

---

## 3. 公共属性

### 自动注入（`posthog.register` 持久化）

| 属性           | team9-homepage            | team9 客户端                           |
| -------------- | ------------------------- | -------------------------------------- |
| `app_name`     | `team9-homepage`          | `team9-app`                            |
| `app_platform` | `homepage`                | `web` / `desktop`（按 Tauri 环境区分） |
| `app_version`  | `NEXT_PUBLIC_APP_VERSION` | `VITE_APP_VERSION`                     |

### 身份属性（PostHog SDK 自动带）

| 属性          | 说明                                                      |
| ------------- | --------------------------------------------------------- |
| `distinct_id` | 匿名/登录统一 ID                                          |
| `user_id`     | 登录后 `identify()` 的 `$user_id`（文档 common property） |
| `$session_id` | PostHog 自带（对应文档的 `session_id`）                   |

### 渠道归因（首次访问捕获，写入 person properties `$set_once`）

| 属性                   | UTM 参数       |
| ---------------------- | -------------- |
| `acquisition_source`   | `utm_source`   |
| `acquisition_medium`   | `utm_medium`   |
| `acquisition_campaign` | `utm_campaign` |
| `acquisition_content`  | `utm_content`  |
| `acquisition_term`     | `utm_term`     |

实现：首屏 `useEffect` 读取 `window.location.search`，检测到任一 UTM 参数时调用 `posthog.setPersonProperties(undefined, acquisitionProps)`（set_once 语义），后续所有事件在 person 维度自动带上。desktop Tauri 下 URL 不含 UTM，跳过即可。

### 业务上下文

- `workspace_id`：team9 客户端通过 `posthog.group("workspace", workspaceId)` 注入（`sync.tsx` 已实现）。team9-homepage 没有 workspace 概念，为 `null`
- `page_key`：每个 `*_viewed` 事件显式指定

---

## 4. 事件 Schema

所有字段使用 `snake_case`。枚举值保持稳定。未知字段传 `null`。

### 4.1 `home_viewed`

| Field      | Type   | Value    |
| ---------- | ------ | -------- |
| `page_key` | string | `"home"` |

触发：HomePage 客户端子组件挂载时单次触发（`useEffect` + `ref` 守护）。

### 4.2 `home_signup_button_clicked`

| Field             | Type | Value                              |
| ----------------- | ---- | ---------------------------------- |
| `button_location` | enum | `"hero"` / `"header"` / `"footer"` |

触发位置（基于 `components/HomePage.tsx`）：

- `header`：L90-95 `<a>Sign Up</a>`
- `hero`：L138-145 "Start for Free" 按钮
- `footer`：L1837 `aria-label="Get started with Team9"` 按钮

### 4.3 `home_download_button_clicked`

| Field             | Type | Value                              |
| ----------------- | ---- | ---------------------------------- |
| `button_location` | enum | `"hero"` / `"header"` / `"footer"` |

触发位置：`components/DownloadButton.tsx` 的 `handleDownload()` 开头，`button_location: "hero"`（当前只有 hero 位置）。

### 4.4 `signup_page_viewed`

| Field      | Type   | Value      |
| ---------- | ------ | ---------- |
| `page_key` | string | `"signup"` |

触发：`/login` 页面组件挂载时单次触发。备注：当前 team9 客户端 `/login` 是统一登录/注册页，本事件表示"潜在注册入口曝光"。

### 4.5 `signup_button_clicked`

| Field           | Type | Value                                            |
| --------------- | ---- | ------------------------------------------------ |
| `signup_method` | enum | `"email"` / `"google"` / `"apple"`（apple 预留） |

触发：

- Email 流：`handleEmailSubmit` 最开头（用户点击"Continue with Email"），`signup_method: "email"`
- Google 流：`handleGoogleSuccess` 最开头（拿到 credential 后），`signup_method: "google"`

### 4.6 `signup_completed`

| Field           | Type | Value                              |
| --------------- | ---- | ---------------------------------- |
| `signup_method` | enum | `"email"` / `"google"` / `"apple"` |

触发：**仅当后端返回 `isNewUser === true` 时**，表示真实新用户注册完成（老用户登录不触发）。

- 位置：`navigateAfterAuth()` 中
- 同时推 dataLayer：`{ event: "conversion_signup_completed", signup_method }`

**依赖后端改动**：`AuthResponse` 需新增 `isNewUser: boolean` 字段（见 §6.1）。

### 4.7 `onboarding_step_viewed`

| Field        | Type   | Value                                                                    |
| ------------ | ------ | ------------------------------------------------------------------------ |
| `step_name`  | string | `"role"` / `"tasks"` / `"channels"` / `"agents"` / `"invite"` / `"plan"` |
| `step_index` | number | `1`–`6`                                                                  |

触发：`currentStep` 变化时（包括首次进入），`useEffect` 监听 `currentStep`，用 `ref` 防同一 step 重复触发。

**步骤常量**：

```ts
const ONBOARDING_STEPS = {
  1: "role",
  2: "tasks",
  3: "channels",
  4: "agents",
  5: "invite",
  6: "plan",
} as const;
```

额外规则：Step 6（`plan`）曝光时，同时触发 `subscription_plan_page_viewed`，`entry_source: "onboarding"`（见 §4.9）。

### 4.8 `onboarding_completed`

| Field          | Type           | Value                               |
| -------------- | -------------- | ----------------------------------- |
| `workspace_id` | string \| null | 完成 onboarding 时所在 workspace ID |

触发：`completeOnboarding.mutateAsync()` 成功且 `result.status === "provisioned"` 时。

### 4.9 `subscription_plan_page_viewed`

| Field          | Type | Value                                          |
| -------------- | ---- | ---------------------------------------------- |
| `entry_source` | enum | `"home"` / `"onboarding"` / `"manage_credits"` |

触发：

- `/subscription` 路由：`useEffect` 首次挂载或 `source` URL 参数变化时触发。URL 未带 `source` 时 fallback 到 `"manage_credits"`（保守默认）
- Onboarding Step 6 曝光时：额外触发一次，`entry_source: "onboarding"`

**`entry_source` 通过 URL `?source=xxx` 参数传递**（见 §6.4）。

### 4.10 `subscription_button_clicked`

**对原文档 schema 的增补**（双单位 + 拆档位）：

| Field              | Type           | 订阅场景                                              | credits 充值场景                 |
| ------------------ | -------------- | ----------------------------------------------------- | -------------------------------- |
| `entry_source`     | enum           | `home`/`onboarding`/`manage_credits`                  | 同左                             |
| `plan_name`        | string         | 套餐族 slug：`pro` / `team` / `enterprise`            | `"credits_topup"`                |
| `amount_cents`     | number         | `product.amountCents`（如 `4000` / `8000` / `20000`） | 用户选的金额（如 `1000` = $10）  |
| `billing_interval` | string \| null | `"monthly"` / `"yearly"`                              | `null`                           |
| `credits_amount`   | number \| null | `product.credits`（套餐附带，可能为 null）            | 用户获得的 credits（如 `10000`） |
| `stripe_price_id`  | string \| null | `product.stripePriceId`（精确到档位，便于下钻）       | `product.stripePriceId`          |
| `button_name`      | string \| null | 按钮 i18n key 或文案                                  | 同左                             |

**增补字段的动机**：

- Pro 套餐有多档（40/80/200 美元）——用 `plan_name="pro"` 作为套餐族，`amount_cents` 区分具体档位
- credits 充值分析师需要美元单位——`amount_cents`（美元美分）和 `credits_amount`（credits 数量）双写入
- `stripe_price_id` 作为桥梁，PostHog 事件可与后端/Stripe 数据 join

触发位置（基于 `components/layout/contents/SubscriptionContent.tsx`）：

- 订阅套餐"Choose Plan"按钮：L886-891 `onAction`
- credits 自定义金额"Add Credits"按钮：L554-572
- credits 固定档位按钮：L615-624

---

## 5. team9-homepage 实现

### 技术栈

Next.js 16 + next-intl + React 19 + Tailwind 4。App Router，`app/[locale]/` 和 `app/(root)/` 两套布局镜像。当前仅接入 GA + GTM（`@next/third-parties/google`），无 PostHog。

### 文件改动清单

| 文件                                | 动作                                                   |
| ----------------------------------- | ------------------------------------------------------ |
| `package.json`                      | 新增 `posthog-js` 依赖                                 |
| `utils/env.ts`                      | 导出 `POSTHOG_KEY`、`POSTHOG_HOST`                     |
| `.example.env`                      | 新增示例 env                                           |
| `utils/analytics/posthog-client.ts` | 新建：懒加载 + init                                    |
| `utils/analytics/provider.tsx`      | 新建："use client" PostHog Provider                    |
| `utils/analytics/capture.ts`        | 新建：统一 capture + dataLayer 桥接                    |
| `utils/analytics/acquisition.ts`    | 新建：UTM 首次访问捕获（`$set_once`）                  |
| `utils/analytics/events.ts`         | 新建：事件名常量 + 参数类型                            |
| `components/AppShell.tsx`           | 挂 `<PostHogProvider>`（客户端边界）                   |
| `components/HomePage.tsx`           | 抽出客户端 CTA 子组件，埋 `home_viewed` + 注册按钮点击 |
| `components/DownloadButton.tsx`     | 埋 `home_download_button_clicked`                      |

### PostHog 配置（与 team9 客户端对齐）

```ts
// utils/analytics/posthog-client.ts
posthog.init(key, {
  api_host: host,
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
});

posthog.register({
  app_name: "team9-homepage",
  app_platform: "homepage",
  app_version: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0",
});
```

### Server/Client 边界策略

HomePage.tsx 当前是 Server Component（`async function` + `getTranslations`）。为保留 SEO/预渲染优势，**只把触发事件的 CTA 部分抽成客户端子组件**：

- `HeaderCTAGroup` — Sign In / Sign Up 按钮
- `HeroCTAGroup` — DownloadButton + Start for Free
- `FooterCTAGroup` — Get started with Team9 按钮
- `HomeViewTracker` — 只负责 `home_viewed` capture 的 `"use client"` 空组件

其它内容仍为 Server Component。

### UTM 捕获

```ts
// utils/analytics/acquisition.ts
export function captureAcquisitionOnce(posthog: PostHog) {
  const params = new URLSearchParams(window.location.search);
  const acquisition = {
    acquisition_source: params.get("utm_source"),
    acquisition_medium: params.get("utm_medium"),
    acquisition_campaign: params.get("utm_campaign"),
    acquisition_content: params.get("utm_content"),
    acquisition_term: params.get("utm_term"),
  };

  if (Object.values(acquisition).some(Boolean)) {
    // set_once: only write if person doesn't have these properties yet
    posthog.setPersonProperties(undefined, acquisition);
  }
}
```

### dataLayer 桥接

```ts
// utils/analytics/capture.ts
const BRIDGE_EVENTS: Record<string, string> = {
  home_signup_button_clicked: "conversion_signup_click",
  home_download_button_clicked: "conversion_download_click",
};

export function capture(event: string, props: Record<string, unknown>) {
  posthog?.capture(event, props);

  const gtmEvent = BRIDGE_EVENTS[event];
  if (gtmEvent && typeof window !== "undefined") {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: gtmEvent, ...props });
  }
}
```

### 新增环境变量

```env
# .example.env
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
NEXT_PUBLIC_APP_VERSION=0.1.0
```

---

## 6. team9 客户端实现

### 6.1 后端：`AuthResponse` 新增 `isNewUser`

**文件**：`apps/server/apps/gateway/src/auth/auth.service.ts`、`auth-response.dto.ts`（或 interface 定义处）。

**变更**：

- `AuthResponse` 类型新增 `isNewUser: boolean`
- `completeSignup()` 返回 `{ ...tokens, user, isNewUser: true }`（含 race 分支 — race 命中已存在用户时返回 `isNewUser: false`）
- `verifyCode()` 老用户登录分支返回 `isNewUser: false`
- `googleLogin()` 按是否命中"插入新用户"分支返回对应值
- 更新 `auth.service.spec.ts` 测试用例

客户端 `hooks/useAuth.ts` 的 mutation 类型补上 `isNewUser`。

### 6.2 新增分析层文件

```
apps/client/src/analytics/posthog/
├── client.ts            # 已有
├── config.ts            # 已有
├── provider.tsx         # 已有（初始化时调用 acquisition.ts）
├── sync.tsx             # 已有
├── hooks.ts             # 已有
├── events.ts            # 新增
├── capture.ts           # 新增（含 dataLayer 桥接）
└── acquisition.ts       # 新增
```

`events.ts`：

```ts
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

export type SubscriptionEntrySource = "home" | "onboarding" | "manage_credits";
```

`capture.ts` 的 `BRIDGE_EVENTS`：

```ts
const BRIDGE_EVENTS: Record<string, string> = {
  signup_completed: "conversion_signup_completed",
  // onboarding_completed 可选接入，第一期暂不做
};
```

### 6.3 登录/注册埋点（`routes/login.tsx`）

**删除**：L459-466 老的 `sign_up_completed` 手动 capture 块。

**新增**：

- `signup_page_viewed`：组件挂载 `useEffect` 单次触发
- `signup_button_clicked`：
  - Email：`handleEmailSubmit` 开头打 `signup_method: "email"`（用户显式点击"Continue with Email"）
  - Google：`handleGoogleSuccess` 开头打 `signup_method: "google"`（口径约定：Google credential 已拿到即视为"按钮点击成功"，因为 `GoogleLogin` 组件不暴露裸 onClick）
- `signup_completed`：`navigateAfterAuth()` 中判断 `isNewUser === true`，触发 + dataLayer 桥接

Desktop 流：现有 flush PostHog → 跳转 `team9://` 的逻辑保留（L571-581）。

### 6.4 Onboarding 埋点（`routes/_authenticated/onboarding.tsx`）

- **保留** 现有 `onboarding_step_completed`（L748）——独立语义"完成某步进入下一步"
- **新增** `onboarding_step_viewed`：`useEffect` 监听 `currentStep`，`ref` 守护同一 step 不重复
- **新增** `onboarding_completed`：L738 前后，`completeOnboarding.mutateAsync()` 成功且 `status === "provisioned"` 时
- **新增** Step 6 曝光时额外触发 `subscription_plan_page_viewed` `entry_source: "onboarding"`
- **新增** Step 6 `handleCheckout()` 调用时触发 `subscription_button_clicked` `entry_source: "onboarding"`

### 6.5 订阅页埋点

**入口侧改动（加 `?source=` URL 参数）：**

| 入口位置                                                                     | 当前                          | 改为                                                    |
| ---------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------- |
| `HomeMainContent.tsx:272` 升级按钮                                           | `search: { view: "plans" }`   | `search: { view: "plans", source: "home" }`             |
| `HomeMainContent.tsx:284` credits 不足                                       | `search: { view: "credits" }` | `search: { view: "credits", source: "manage_credits" }` |
| `HomeMainContent.tsx:316` 另一入口                                           | 按语义补 `source`             | 同原则                                                  |
| 页面内 credits ↔ plans 切换（SubscriptionContent.tsx:333 / 667 / 813 / 936） | 不加 `source`                 | **保持不加**（页面内导航不重置 entry_source）           |

**路由层（`routes/_authenticated/subscription.tsx`）：**

```ts
type SubscriptionSearchParams = {
  workspaceId?: string;
  view?: "plans" | "credits";
  source?: SubscriptionEntrySource; // 新增
};
```

`validateSearch` 对 `source` 做白名单校验，未知值丢弃。

**`SubscriptionContent.tsx` 埋点**：

- `subscription_plan_page_viewed`：`useEffect` 监听 `source`；挂载和 `source` 变化时触发。URL 无 `source` 时 fallback `"manage_credits"`
- `subscription_button_clicked`：订阅按钮（L886）、Add Credits 按钮（L554）、固定档位 credits 按钮（L615）三处，按 §4.10 字段规则填充

### 6.6 现有事件处理

| 事件                        | 动作                 |
| --------------------------- | -------------------- |
| `sign_up_completed`         | **删除**（L459-466） |
| `onboarding_step_completed` | **保留**             |
| `member_invited`            | 保留（无关）         |

---

## 7. Rollout 顺序（分 PR）

| #   | PR                                                                                             | 依赖                       | 风险                 |
| --- | ---------------------------------------------------------------------------------------------- | -------------------------- | -------------------- |
| 1   | 后端 `AuthResponse` 加 `isNewUser`                                                             | 无                         | 低（additive）       |
| 2   | team9 客户端分析层基建（events.ts / capture.ts / acquisition.ts，+ provider 调用 acquisition） | 无                         | 无（不发新事件）     |
| 3   | team9 客户端业务埋点（login / onboarding / subscription）                                      | PR1 + PR2                  | 低                   |
| 4   | team9 客户端清理老事件（删 `sign_up_completed`）                                               | PR3，且 PostHog 后台无依赖 | **中**（需运营确认） |
| 5   | team9-homepage 接入 PostHog + 3 个 home 事件                                                   | 无                         | 无                   |

5 个 PR 可以并行推进，除了 PR3 → PR4 的顺序。

---

## 8. 验证

### 开发期自测清单

- [ ] 所有事件名、properties 字段名、枚举值与本文档严格一致（snake_case）
- [ ] 未登录场景 `user_id` 为 null/不带；登录后 identify，后续事件带 `user_id`
- [ ] 从 homepage 跳到 app 后 `distinct_id` 保持一致（跨子域 cookie 验证）
- [ ] 带 `?utm_source=google_ads&utm_medium=cpc&utm_campaign=spring` 访问 homepage，跳转到 app 注册，`signup_completed` 的 person properties 包含 `acquisition_source: google_ads`
- [ ] 同一 page 曝光事件不重复触发（ref 守护生效）
- [ ] Onboarding 每步 `onboarding_step_viewed` 触发一次；来回切换不重复
- [ ] Step 6 曝光触发 `subscription_plan_page_viewed` `entry_source: "onboarding"`
- [ ] dataLayer 里可以看到 `conversion_signup_click` / `conversion_download_click` / `conversion_signup_completed`
- [ ] `signup_completed` 仅在 `isNewUser === true` 时触发，老用户登录不触发

### PostHog 后台验证

- PostHog → Live events 过滤 `app_name: team9-homepage` / `team9-app`，确认事件实时上报
- Person 维度查看 `acquisition_*` 是否正确写入

### 回归风险

- **中风险**：删除 `sign_up_completed` 前必须与数据/PM 确认 PostHog 后台无依赖
- **低风险**：其他改动均为 additive

---

## 9. 配置上线 Checklist

| 项                                                                         | 责任方  | 状态         |
| -------------------------------------------------------------------------- | ------- | ------------ |
| PostHog 项目 key（两仓库共用）                                             | 运维/PM | 待确认       |
| team9-homepage env：`NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST` | 运维    | 待配置       |
| team9 客户端 env：`VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST`（各环境）       | 运维    | 需确认现状   |
| team9.ai 与 app.team9.ai 同主域                                            | 运维    | 待确认       |
| PostHog 后台 `sign_up_completed` 无看板依赖                                | 数据/PM | 删除前必确认 |
