# Analytics Strategy Design: team9-homepage + team9 App

**Date:** 2026-04-10
**Status:** Draft
**Scope:** Full analytics architecture spanning team9-homepage (marketing site) and team9 App (product)

---

## 1. Overview

Two products, two analytics strategies, unified user identity:

| Product            | Domain         | Analytics Tools                                   | Purpose                                                          |
| ------------------ | -------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| **team9-homepage** | `team9.ai`     | PostHog JS + GTM + GA4 (via GTM Server Container) | Marketing: traffic attribution, ad conversion, download tracking |
| **team9 App**      | `app.team9.ai` | PostHog JS (frontend) + PostHog Node (backend)    | Product: feature usage, growth metrics, retention                |

**Key decisions:**

- team9 App does **not** use GTM — PostHog alone covers all product analytics needs
- GTM Server Container only serves the homepage, deployed on GCP Cloud Run at `sgtm.team9.ai`
- Both products share a **single PostHog project** with `cookie_domain: ".team9.ai"` for cross-product identity stitching (desktop login opens system browser which bridges the cookie gap — see Section 6.4)
- Privacy/compliance (cookie consent, GDPR) is out of scope for this document and will be addressed separately

## 2. Architecture

```
                        +----------------------------------+
                        |          PostHog (Cloud)          |
                        |    Unified identity + analytics   |
                        |    cookie domain: .team9.ai       |
                        +------+----------------+----------+
                               |                |
              +----------------+                +----------------+
              v                                                  v
+--------------------------+              +-------------------------------+
|   team9.ai (Homepage)    |              |   app.team9.ai (Team9 App)    |
|   Next.js static site    |              |   Tauri desktop + Web         |
|                          |              |                               |
|   +- PostHog JS --------+|              |   +- PostHog JS -------------+|
|   | Anonymous tracking   ||   cookie    |   | identify(userId)          ||
|   | Page views, CTA      || ----------> |   | group("workspace", id)    ||
|   | Downloads            ||  .team9.ai  |   | Product behavior tracking ||
|   +----------------------+|   identity  |   +---------------------------+|
|                          |   stitch    |                               |
|   +- GTM Web Container --+|              |   (No GTM)                    |
|   | GA4 Tag -> sGTM      ||              |                               |
|   | Future: FB / others   ||              |   +- PostHog Node (backend) -+|
|   +----------------------+|              |   | Server-side event tracking ||
|              |            |              |   +---------------------------+|
+--------------+------------+              +-------------------------------+
               v
+--------------------------+
|  GTM Server Container    |
|  sgtm.team9.ai           |
|  (GCP Cloud Run)         |
|                          |
|  GA4 Client -> Event Data|
|       |                  |
|  +----+--+  +-------+   |
|  | GA4   |  |FB CAPI|...|
|  | Tag   |  | Tag   |   |
|  +-------+  +-------+   |
+--------------------------+
```

## 3. team9-homepage Analytics

### 3.1 Tool Responsibilities

| Tool                  | Responsibility                                         | Data Flow                                 |
| --------------------- | ------------------------------------------------------ | ----------------------------------------- |
| **PostHog JS**        | User behavior analytics + identity stitching           | Direct to PostHog                         |
| **GTM Web Container** | Marketing tag management + multi-platform distribution | -> GTM Server Container -> GA4 / FB / ... |

The two tools operate independently and do not interfere with each other.

### 3.2 PostHog Integration (New)

Add `posthog-js` to the homepage with lightweight configuration:

```typescript
posthog.init(POSTHOG_KEY, {
  api_host: "https://us.i.posthog.com",
  cookie_domain: ".team9.ai", // Cross-subdomain identity stitching
  autocapture: true, // Simple pages, autocapture is sufficient
  capture_pageview: true,
  capture_pageleave: true,
});
```

The homepage does **not** call `identify()` — users are anonymous at this stage. PostHog assigns an `anonymous_id` stored in a `.team9.ai` cookie. Identity merge happens when the user registers/logs in at `app.team9.ai`.

### 3.3 Events to Track

| Event                  | Trigger                      | Collection Method                        | Purpose              |
| ---------------------- | ---------------------------- | ---------------------------------------- | -------------------- |
| `page_view`            | Each page load               | PostHog auto + GA4 auto                  | Traffic analysis     |
| `cta_clicked`          | Click "Start Free" / "Login" | `posthog.capture()` + `dataLayer.push()` | Conversion funnel    |
| `download_clicked`     | Click download button        | `posthog.capture()` + `dataLayer.push()` | Download conversion  |
| `pricing_viewed`       | Enter pricing page           | Auto (page_view)                         | Interest measurement |
| `pricing_plan_clicked` | Click a pricing plan         | `posthog.capture()` + `dataLayer.push()` | Purchase intent      |
| `language_switched`    | Switch language              | `posthog.capture()`                      | User preference      |

Events pushed to `dataLayer` allow marketing team to manage distribution to GA4, Facebook, etc. via the GTM UI. PostHog captures independently for product analytics completeness.

### 3.4 GTM + GA4 Configuration (GTM UI, No Code)

The existing `@next/third-parties/google` `GoogleTagManager` component is already in `AppShell.tsx`. Only `NEXT_PUBLIC_GTM_ID` needs to be set.

**Web Container configuration:**

| Item                  | Action                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| GA4 Configuration Tag | Set Measurement ID `G-XXXXXXX`, set `server_container_url: https://sgtm.team9.ai`                |
| GA4 Event Tags        | Create Tags for each dataLayer event (`cta_clicked`, `download_clicked`, `pricing_plan_clicked`) |
| Triggers              | Custom Event triggers based on dataLayer events                                                  |

**Server Container configuration:**

| Item        | Action                                               |
| ----------- | ---------------------------------------------------- |
| GA4 Client  | Pre-installed, no configuration needed               |
| GA4 Tag     | Set Measurement ID, forwards to Google Analytics     |
| Future Tags | Add Facebook CAPI, TikTok Events API, etc. as needed |

### 3.5 Environment Variables

| Variable                   | Location              | Description                                                                                                      |
| -------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_GTM_ID`       | team9-homepage `.env` | GTM Web Container ID (existing, needs value)                                                                     |
| `NEXT_PUBLIC_GA_ID`        | team9-homepage `.env` | GA4 Measurement ID (existing) — **do NOT set** if GA4 is loaded via GTM, otherwise events will be double-counted |
| `NEXT_PUBLIC_POSTHOG_KEY`  | team9-homepage `.env` | PostHog Project API Key (new)                                                                                    |
| `NEXT_PUBLIC_POSTHOG_HOST` | team9-homepage `.env` | PostHog API host (new, default `https://us.i.posthog.com`)                                                       |

## 4. team9 App Analytics

### 4.1 Tools: PostHog Only

No GTM. Frontend uses `posthog-js` (already integrated), backend uses `posthog-node` (already integrated).

### 4.2 Code Changes Required

Changes in `apps/client/src/analytics/posthog/client.ts`:

```diff
+import { isTauriApp } from "@/lib/tauri";
+
+const isDesktop = isTauriApp();
+
 posthog.init(config.key, {
   api_host: config.host,
+  cookie_domain: isDesktop ? undefined : ".team9.ai",
   autocapture: false,
   capture_pageview: false,
   // ... rest unchanged
 });
+
+posthog.register({
+  app_name: "team9-app",
+  app_version: APP_VERSION,          // Read from package.json or Tauri app.getVersion()
+  app_platform: isDesktop ? "desktop" : "web",
+});
```

**Notes:**

- `cookie_domain` is only set on Web (`app.team9.ai`). On Tauri desktop, the origin is `tauri://localhost` so `.team9.ai` cookies are inaccessible — PostHog falls back to `localStorage` which is correct for desktop.
- `posthog.register()` sets super properties that are automatically attached to all subsequent events.
- Property names use no `$` prefix — `$` is reserved for PostHog system properties (e.g., `$browser`, `$os`).

All existing code (Provider, sync.tsx identify/group, hooks) remains untouched.

### 4.3 Frontend Events

#### Tier 1: Growth / Conversion Events (Highest Priority)

| Event                | Trigger                  | Properties                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sign_up_completed`  | Registration success     | `{ method: "email" \| "google" }`                                                                                                                                                                                                                                                                                                   |
| `onboarding_step`    | Complete onboarding step | `{ step: number, step_name: string }`                                                                                                                                                                                                                                                                                               |
| `workspace_created`  | Create workspace         | `{ workspace_id }`                                                                                                                                                                                                                                                                                                                  |
| `member_invited`     | Invite members           | `{ workspace_id, count }`                                                                                                                                                                                                                                                                                                           |
| `first_message_sent` | User sends first message | `{ channel_type }` — **Implementation note:** requires new `has_sent_message` boolean field on user DB schema (migration + service logic); first `message_sent` where this flag is `false` triggers this event and flips the flag. This is backend-driven (not a simple frontend capture) and should be estimated as separate work. |

#### Tier 2: Core Feature Usage Events

| Event              | Trigger              | Properties                                                       |
| ------------------ | -------------------- | ---------------------------------------------------------------- |
| `message_sent`     | Send message         | `{ channel_type, has_attachment, has_mention, is_thread_reply }` |
| `channel_created`  | Create channel       | `{ type: "public" \| "private" \| "dm" }`                        |
| `channel_joined`   | Join channel         | `{ type, source: "invite" \| "browse" }`                         |
| `reaction_added`   | Add emoji reaction   | `{ emoji }`                                                      |
| `file_uploaded`    | Upload file          | `{ file_type, size_bucket }`                                     |
| `bot_created`      | Create bot           | `{ workspace_id }`                                               |
| `ai_feature_used`  | Use AI feature       | `{ feature_name }`                                               |
| `search_performed` | Use search           | `{ has_results: boolean }`                                       |
| `thread_created`   | Start a thread reply | `{ channel_type }`                                               |

#### Tier 3: Retention / Engagement Events

| Event                  | Trigger                               | Properties                                                                                    |
| ---------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `app_opened`           | Open application                      | `{ platform: "web" \| "desktop" }`                                                            |
| `app_session_started`  | App loaded or resumed from background | `{ platform }` — distinct from PostHog's built-in session tracking (30min inactivity timeout) |
| `channel_switched`     | Switch channel                        | `{ from_type, to_type }`                                                                      |
| `notification_clicked` | Click notification                    | `{ notification_type }`                                                                       |

### 4.4 Backend Events

Sent via the existing `PosthogService.capture()` — events that cannot be reliably tracked from the frontend.

**Default properties:** `posthog-node` has no `register()` equivalent. `PosthogService.capture()` should be enhanced to automatically merge `{ app_name: "team9-server" }` into all events, so backend events are distinguishable from frontend events in PostHog dashboards.

| Event                       | Service Location     | Properties                                                                          |
| --------------------------- | -------------------- | ----------------------------------------------------------------------------------- |
| `workspace_member_joined`   | WorkspaceService     | `{ workspace_id, role, invite_method }` — **high priority**: key growth funnel node |
| `invite_accepted`           | WorkspaceService     | `{ workspace_id, invited_by }`                                                      |
| `bot_execution_started`     | TaskCast integration | `{ bot_id, task_type }`                                                             |
| `bot_execution_completed`   | TaskCast webhook     | `{ bot_id, duration_ms, status }`                                                   |
| `message_delivered`         | IM Worker            | `{ channel_type, latency_ms }`                                                      |
| `openclaw_instance_created` | OpenclawService      | `{ workspace_id }`                                                                  |
| `subscription_changed`      | BillingHub           | `{ plan, action: "upgrade" \| "downgrade" \| "cancel" }`                            |

### 4.5 Usage Examples

**Frontend (React):**

```tsx
const { capture } = usePostHogAnalytics();

capture("message_sent", {
  channel_type: "public",
  has_attachment: false,
  has_mention: true,
  is_thread_reply: false,
});
```

**Backend (NestJS):**

```typescript
this.posthog.capture({
  distinctId: userId,
  event: "bot_execution_completed",
  properties: { bot_id: botId, duration_ms: 1234, status: "success" },
  groups: { workspace: workspaceId },
});
```

## 5. GTM Server Container Deployment

### 5.1 Scope

The GTM Server Container only serves requests from `team9.ai` (homepage). team9 App does not route through it.

### 5.2 GCP Cloud Run Configuration

| Setting                  | Value                                                  | Notes                                       |
| ------------------------ | ------------------------------------------------------ | ------------------------------------------- |
| **Docker image**         | `gcr.io/cloud-tagging-10302018/gtm-cloud-image:stable` | Official Google image                       |
| **Environment variable** | `CONTAINER_CONFIG=<from GTM>`                          | Server Container config string              |
| **Instances**            | min 1, max 4                                           | Homepage traffic is moderate                |
| **CPU / Memory**         | 1 vCPU / 512MB                                         | Minimum recommended                         |
| **Region**               | `us-central1`                                          | Close to PostHog US and GA4 endpoints       |
| **Cost estimate**        | ~$25-45/month                                          | Low-traffic scenario, 1 instance sufficient |

### 5.3 Domain Configuration

```
sgtm.team9.ai  ->  CNAME  ->  Cloud Run service domain
```

Must use a `team9.ai` subdomain so that:

- Browser treats requests as first-party (bypasses ad blockers)
- Cookies under `.team9.ai` are accessible

### 5.4 Failure Handling

If `sgtm.team9.ai` (Cloud Run) goes down, GA4 requests from the GTM Web Container will fail silently — no data is sent to GA4 or downstream platforms until the service recovers. This is acceptable for a marketing analytics pipeline (no user-facing impact). Cloud Run auto-scaling and health checks provide sufficient reliability for this use case. If higher availability is needed in the future, consider configuring the GA4 Configuration Tag with a fallback `transport_url` pointing directly to `www.google-analytics.com`.

## 6. Cross-Product Identity Stitching

### 6.1 How It Works

```
User journey timeline:

[1] team9.ai — anonymous browsing
    PostHog assigns anonymous_id = "anon_abc123"
    Cookie written: .team9.ai -> ph_<key>_posthog = { distinct_id: "anon_abc123" }

[2] Click "Start Free" -> redirect to app.team9.ai
    Browser carries .team9.ai cookie
    PostHog reads the same anonymous_id = "anon_abc123"

[3] User registers, App calls posthog.identify("user_real_id_456")
    PostHog server automatically merges:
    All events from anon_abc123 -> attributed to user_real_id_456

[4] In PostHog dashboard, user_real_id_456's timeline shows:
    - Homepage page view (from team9.ai)
    - CTA click (from team9.ai)
    - Sign up completed (from app.team9.ai)
    - Workspace created (from app.team9.ai)
    - First message sent (from app.team9.ai)
```

### 6.2 Configuration Comparison

| Setting              | team9.ai (Homepage)                 | app.team9.ai (App)                                             |
| -------------------- | ----------------------------------- | -------------------------------------------------------------- |
| `cookie_domain`      | `.team9.ai`                         | `.team9.ai`                                                    |
| `posthog.identify()` | **Not called** (anonymous visitors) | Called on login/register (existing sync.tsx handles this)      |
| `posthog.group()`    | **Not called**                      | Called on workspace selection (existing sync.tsx handles this) |
| `api_host`           | `https://us.i.posthog.com`          | `https://us.i.posthog.com`                                     |
| **PostHog Project**  | **Same project**                    | **Same project**                                               |

### 6.3 Distinguishing Event Sources

Both products share one PostHog project. Use super properties (without `$` prefix — that's reserved for PostHog system properties) to distinguish source:

```typescript
// Homepage — set on initialization
posthog.register({
  app_name: "homepage",
  app_version: HOMEPAGE_VERSION, // Read from package.json at build time
});

// App — set on initialization (see Section 4.2 for full code)
posthog.register({
  app_name: "team9-app",
  app_version: APP_VERSION, // Read from package.json or Tauri app.getVersion()
  app_platform: isDesktop ? "desktop" : "web",
});

// Backend — injected automatically by PosthogService (see Section 4.4)
// { app_name: "team9-server" }
```

Filter by `app_name` in PostHog dashboard to view homepage vs App vs backend data separately, or combine for full-funnel analysis.

### 6.4 Tauri Desktop Identity Stitching

The Tauri desktop app's origin is `tauri://localhost`, so it **cannot directly access `.team9.ai` cookies**. However, the existing desktop login flow naturally bridges this gap — no additional development required.

**Why it works:** Desktop login is implemented as an OAuth-style flow that opens the **system browser** (not a WebView) to `app.team9.ai/login`. The system browser has full access to `.team9.ai` cookies, including the PostHog `anonymous_id` set during homepage browsing.

**Existing desktop login flow** (see `apps/client/src/routes/login.tsx`, `apps/client/src/hooks/useDeepLink.ts`):

```
[1] Homepage (team9.ai) — system browser
    User browses homepage, clicks download
    PostHog assigns anonymous_id = "anon_abc123"
    Cookie: .team9.ai → ph_<key>_posthog = { distinct_id: "anon_abc123" }
    Events: page_view, download_clicked

[2] User installs and opens Tauri desktop app
    Desktop PostHog assigns separate anonymous_id = "desktop_xyz789" (localStorage)
    Event: app_opened (app_platform=desktop)

[3] User clicks "Sign In with Browser" in desktop app
    Desktop creates session: POST /v1/auth/create-desktop-session → { sessionId }
    Desktop opens system browser: https://app.team9.ai/login?desktopSessionId={sessionId}

[4] System browser opens app.team9.ai — cookie bridge!
    Browser reads .team9.ai cookie → PostHog recognizes anon_abc123
    User completes login (email/code or Google OAuth)
    posthog.identify("user_456") is called by sync.tsx
    → PostHog merges: anon_abc123 (homepage events) → user_456  ✅
    ⚠️ FLUSH TIMING: the browser will redirect to team9:// deep link shortly after.
    Must await posthog.flush() BEFORE the deep link redirect to ensure
    the identify event is sent. (Small code change in login.tsx's desktop
    session completion flow — insert flush between auth completion and
    the useEffect that triggers the team9:// redirect.)

[5] Browser triggers deep link: team9://auth-complete?sessionId={sessionId}
    Desktop receives deep link via @tauri-apps/plugin-deep-link
    Desktop polls: GET /v1/auth/poll-login → receives tokens + user data
    Desktop calls posthog.identify("user_456")
    → PostHog merges: desktop_xyz789 (desktop events) → user_456  ✅
    (This is the RELIABLE merge point — even if step [4] flush fails,
    the desktop identify still links desktop events to the user.
    The homepage→user merge from step [4] is best-effort.)

[6] Result: user_456's PostHog timeline shows the complete journey:
    ✅ Homepage page_view          (team9.ai, anon_abc123)
    ✅ Homepage download_clicked   (team9.ai, anon_abc123)
    ✅ Desktop app_opened          (Tauri, desktop_xyz789)
    ✅ Login completed             (app.team9.ai, browser bridge)
    ✅ All subsequent desktop events (Tauri, user_456)
```

**Key insight:** The system browser acts as the identity bridge between three worlds — homepage cookies, the authentication server, and the desktop app via deep link. PostHog's `identify()` call in step [4] (browser) and step [5] (desktop) causes two separate identity merges, resulting in a unified user timeline.

**Technical requirements:**

- `cookie_domain: ".team9.ai"` on both homepage and `app.team9.ai` PostHog init — **covered in Section 3.2 and 4.2**
- `posthog.identify(userId)` called on login — **covered by existing `sync.tsx`**
- Desktop login opens system browser — **existing flow via `@tauri-apps/plugin-opener`**
- Deep link callback returns to desktop — **existing flow via `@tauri-apps/plugin-deep-link`**
- **New: add `posthog.flush()` before deep link redirect in `login.tsx`** — ensures browser-side identity merge is sent before the page navigates away (small code change in desktop session completion flow)

**No additional code changes needed for desktop identity stitching.**

### 6.5 Full Funnel Examples

**Web flow** (homepage → web app):

```
Homepage page_view             (app_name=homepage)
    |
Homepage cta_clicked           (app_name=homepage)
    |
App sign_up_completed          (app_name=team9-app, app_platform=web)
    |
App workspace_created          (app_name=team9-app)
    |
App member_invited             (app_name=team9-app)
    |
App first_message_sent         (app_name=team9-app)
```

**Desktop flow** (homepage → download → desktop app):

```
Homepage page_view             (app_name=homepage)
    |
Homepage download_clicked      (app_name=homepage)
    |
Desktop app_opened             (app_name=team9-app, app_platform=desktop)
    |
Desktop sign_up_completed      (app_name=team9-app, app_platform=desktop)
  (via browser bridge login)
    |
Desktop workspace_created      (app_name=team9-app, app_platform=desktop)
    |
Desktop first_message_sent     (app_name=team9-app, app_platform=desktop)
```

PostHog Funnels can visualize both flows, filter by `app_platform` to compare Web vs Desktop conversion rates.

## 7. Implementation Summary

### 7.1 team9-homepage (New Work)

| Task                                                                                | Effort           |
| ----------------------------------------------------------------------------------- | ---------------- |
| Add `posthog-js` dependency                                                         | Small            |
| Initialize PostHog with `cookie_domain: ".team9.ai"` and `app_name: "homepage"`     | Small            |
| Add `posthog.capture()` + `dataLayer.push()` to CTA, download, pricing interactions | Medium           |
| Set `NEXT_PUBLIC_GTM_ID` and `NEXT_PUBLIC_POSTHOG_KEY` in production env            | Small            |
| Configure GTM Web Container tags/triggers in GTM UI                                 | Medium (no code) |
| Deploy GTM Server Container to Cloud Run                                            | Medium           |
| Configure `sgtm.team9.ai` DNS                                                       | Small            |

### 7.2 team9 App (Minimal Changes)

| Task                                                                                                                                                                                                     | Effort                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Add `cookie_domain` (Web) / `localStorage` (desktop) to PostHog init in `client.ts`                                                                                                                      | Trivial                   |
| Add `posthog.register({ app_name, app_version, app_platform })` to PostHog init                                                                                                                          | Trivial                   |
| Enhance `PosthogService.capture()` to auto-inject `app_name: "team9-server"`                                                                                                                             | Trivial                   |
| Add `posthog.flush()` before deep link redirect in `login.tsx` desktop session flow                                                                                                                      | Small                     |
| Add `posthog.capture()` calls for Tier 1 growth events (except `first_message_sent`)                                                                                                                     | Medium                    |
| Add `has_sent_message` field to user schema + migration + `first_message_sent` backend logic                                                                                                             | Medium (DB schema change) |
| Add `posthog.capture()` calls for Tier 2 feature usage events                                                                                                                                            | Medium                    |
| Add `posthog.capture()` calls for Tier 3 retention events                                                                                                                                                | Small                     |
| Add `PosthogService.capture()` calls for backend events                                                                                                                                                  | Medium                    |
| Remove unused GTM code from `main.tsx` (delete `react-gtm-module` import, `TagManager.initialize()` call, and `VITE_GTM_ID` env read; uninstall `react-gtm-module` + `@types/react-gtm-module` packages) | Trivial                   |

### 7.3 Priority Order

1. **App Tier 1 events + key backend events** (`workspace_member_joined`, `invite_accepted`, `subscription_changed`) — growth/conversion tracking (immediate value)
2. **Homepage PostHog + identity stitching** — full funnel visibility
3. **Homepage GTM + GA4** — marketing attribution
4. **App Tier 2 events** — feature usage insights
5. **GTM Server Container** — ad platform integration
6. **App Tier 3 events + remaining backend events** — retention analysis and server-side tracking
