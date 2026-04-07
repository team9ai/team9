# Notification System Implementation Plan

## Overview

Implement OS-level notifications for Team9: **Web Push** (Service Worker + VAPID) for browser, **system notifications** (tauri-plugin-notification) for desktop app. Includes notification preferences UI, same-device Tauri/Web dedup via localhost probe, and configurable focus suppression.

## Architecture

```
                           ┌─────────────────────────────────┐
                           │  im-worker (existing)           │
                           │  NotificationTriggerService     │
                           │  → creates notification in DB   │
                           │  → publishes delivery task      │
                           └───────────┬─────────────────────┘
                                       │ RabbitMQ
                           ┌───────────▼─────────────────────┐
                           │  Gateway                        │
                           │  NotificationDeliveryConsumer    │
                           │  ┌───────────────────────────┐  │
                           │  │ NotificationDeliveryService│  │
                           │  │  ├─ WebSocket (existing)   │  │
                           │  │  └─ Web Push (NEW)  ───────│──│──→ Push Service → Browser SW
                           │  └───────────────────────────┘  │
                           └──────────────┬──────────────────┘
                                          │ WebSocket
                    ┌─────────────────────┼─────────────────────┐
                    │                     │                     │
              ┌─────▼──────┐       ┌──────▼─────┐       ┌──────▼──────┐
              │ Web Tab     │       │ Web Tab    │       │ Tauri App   │
              │ (background)│       │ (active)   │       │             │
              └─────────────┘       └────────────┘       │ localhost   │
                                                         │ :19876      │
              ┌─────────────┐                            │ /health     │
              │ Service      │◄── push event ────────────└─────────────┘
              │ Worker       │                                  ▲
              │  ├─ probe localhost:19876                       │
              │  ├─ if Tauri alive → suppress                  │
              │  └─ else → showNotification()    probe ────────┘
              └─────────────┘
```

## Dependencies

| Where      | Package                                 | Purpose                               |
| ---------- | --------------------------------------- | ------------------------------------- |
| Server     | `web-push` (npm)                        | Send VAPID Web Push notifications     |
| Client     | `@tauri-apps/plugin-notification` (npm) | Tauri system notification JS bindings |
| Client     | `vite-plugin-pwa` (npm)                 | Service Worker build & registration   |
| Tauri Rust | `tauri-plugin-notification` (crate)     | Tauri notification plugin             |
| Tauri Rust | `axum` + `tokio` (crates)               | Localhost health HTTP server          |

## Existing Assets

- **DB table `im_notification_preferences`** — already migrated, has all fields: mentionsEnabled, repliesEnabled, dmsEnabled, systemEnabled, workspaceEnabled, desktopEnabled, soundEnabled, DND
- **DB table `im_channel_notification_mutes`** — per-channel muting, already migrated
- **Schema types exported** from `libs/database/src/schemas/im/index.ts`
- **Notification delivery pipeline** — RabbitMQ → Gateway → WebSocket, fully functional
- **`notification_new` WebSocket event** — already received by client in `useWebSocketEvents.ts`
- **MoreMainContent.tsx line 42** — `{ id: "notifications", ... }` commented out, ready to uncomment
- **i18n keys** — `settings.notifications`, `settings.desktop`, `settings.sound` already exist in en/zh

---

## Phase 1: Backend — Notification Preferences API

**Goal:** Expose CRUD endpoints for the existing `im_notification_preferences` table so the frontend can read/update preferences.

### Step 1.1: Create NotificationPreferencesService

**File:** `apps/server/apps/gateway/src/notification-preferences/notification-preferences.service.ts`

- Inject `DATABASE_CONNECTION` (same pattern as `NotificationService`)
- Methods:
  - `getPreferences(userId)` → returns user's preferences, or default values if none exist
  - `upsertPreferences(userId, dto)` → create or update preferences (upsert on unique userId)
  - `shouldNotify(userId, notificationType)` → check if user wants this notification type (used by delivery)
- Use existing `notificationPreferences` schema from `@team9/database/schemas`

### Step 1.2: Create DTOs

**File:** `apps/server/apps/gateway/src/notification-preferences/dto/`

- `UpdateNotificationPreferencesDto` — all boolean fields optional (partial update):
  - mentionsEnabled, repliesEnabled, dmsEnabled, systemEnabled, workspaceEnabled
  - desktopEnabled, soundEnabled
  - dndEnabled, dndStart, dndEnd
- `NotificationPreferencesResponseDto` — full preferences object

### Step 1.3: Create Controller

**File:** `apps/server/apps/gateway/src/notification-preferences/notification-preferences.controller.ts`

- `GET /v1/notification-preferences` → get current user's preferences
- `PATCH /v1/notification-preferences` → partial update
- Both require `@UseGuards(JwtAuthGuard)`

### Step 1.4: Create Module & Register

**File:** `apps/server/apps/gateway/src/notification-preferences/notification-preferences.module.ts`

- Import `AuthModule`
- Register in `app.module.ts` imports

---

## Phase 2: Backend — Push Subscription Infrastructure

**Goal:** Store browser push subscription endpoints per user/device. Add VAPID config and `web-push` library.

### Step 2.1: Add VAPID Environment Variables

**Files to modify:**

- `apps/server/.env.example` — add optional VAPID section:
  ```
  # Web Push (optional — push notifications disabled when not set)
  # Generate VAPID keys: npx web-push generate-vapid-keys
  # VAPID_PUBLIC_KEY=
  # VAPID_PRIVATE_KEY=
  # VAPID_SUBJECT=mailto:noreply@team9.ai
  ```
- `libs/shared/src/env.ts` — add optional getters:
  ```typescript
  get VAPID_PUBLIC_KEY() { return process.env.VAPID_PUBLIC_KEY; }
  get VAPID_PRIVATE_KEY() { return process.env.VAPID_PRIVATE_KEY; }
  get VAPID_SUBJECT() { return process.env.VAPID_SUBJECT || 'mailto:noreply@team9.ai'; }
  ```

### Step 2.2: Install `web-push` Package

```bash
cd apps/server && pnpm add web-push && pnpm add -D @types/web-push
```

### Step 2.3: Create Push Subscriptions DB Schema

**File:** `libs/database/src/schemas/im/push-subscriptions.ts`

```typescript
export const pushSubscriptions = pgTable(
  "im_push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    endpoint: text("endpoint").notNull(), // Web Push endpoint URL
    p256dh: text("p256dh").notNull(), // Client public key
    auth: text("auth").notNull(), // Auth secret
    userAgent: varchar("user_agent", { length: 512 }), // For device identification
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastUsedAt: timestamp("last_used_at"), // Track activity for cleanup
  },
  (table) => [
    unique("unique_push_endpoint").on(table.endpoint),
    index("idx_push_sub_user").on(table.userId),
  ],
);
```

- Export from `schemas/im/index.ts`
- Run `pnpm db:generate` + `pnpm db:migrate`

### Step 2.4: Create PushSubscription Module

**Directory:** `apps/server/apps/gateway/src/push-subscription/`

**Service** (`push-subscription.service.ts`):

- `subscribe(userId, { endpoint, keys: { p256dh, auth }, userAgent })` → upsert by endpoint
- `unsubscribe(endpoint)` → delete by endpoint
- `unsubscribeAll(userId)` → delete all for user
- `getSubscriptions(userId)` → list active subscriptions
- `cleanupStale(olderThan: Date)` → remove subscriptions not used in 30 days

**Controller** (`push-subscription.controller.ts`):

- `POST /v1/push-subscriptions` → subscribe (body: PushSubscription from browser)
- `DELETE /v1/push-subscriptions` → unsubscribe (body: { endpoint })
- All require `@UseGuards(JwtAuthGuard)`

**Module** — register in `app.module.ts`

---

## Phase 3: Backend — Web Push Delivery

**Goal:** Send Web Push notifications alongside WebSocket delivery.

### Step 3.1: Create WebPushService

**File:** `apps/server/apps/gateway/src/notification/web-push.service.ts`

- Initialize `web-push` with VAPID keys on module init (skip if keys not configured)
- `sendPush(userId, notification: NotificationPayload)`:
  1. Get all push subscriptions for user via PushSubscriptionService
  2. For each subscription, call `webpush.sendNotification(subscription, JSON.stringify(payload))`
  3. On 410 Gone or 404 → delete stale subscription (endpoint expired)
  4. On other errors → log, don't throw (push failures are non-blocking)
  5. Update `lastUsedAt` on successful send
- `isEnabled()` → returns true if VAPID keys are configured
- Payload format sent to Service Worker:
  ```json
  {
    "id": "notification-uuid",
    "title": "Username mentioned you",
    "body": "Message preview...",
    "type": "mention",
    "category": "message",
    "actionUrl": "/channels/xxx?message=yyy",
    "actor": { "avatarUrl": "..." }
  }
  ```

### Step 3.2: Integrate into NotificationDeliveryService

**File:** `apps/server/apps/gateway/src/notification/notification-delivery.service.ts`

Modify `deliverToUser()`:

```typescript
async deliverToUser(userId: string, notification: NotificationPayload): Promise<void> {
  // 1. Check user preferences (NEW)
  const prefs = await this.preferencesService.getPreferences(userId);
  if (!this.shouldDeliver(prefs, notification.type, notification.category)) {
    return; // User disabled this notification type
  }

  // 2. WebSocket delivery (EXISTING — unchanged)
  if (isOnline) {
    await this.websocketGateway.sendToUser(userId, WS_NOTIFICATION_EVENTS.NEW, notification);
  }

  // 3. Web Push delivery (NEW — always send if enabled, SW decides display)
  if (this.webPushService.isEnabled() && prefs.desktopEnabled) {
    await this.webPushService.sendPush(userId, notification);
  }
}
```

### Step 3.3: Update NotificationModule

**File:** `apps/server/apps/gateway/src/notification/notification.module.ts`

- Import `PushSubscriptionModule` and `NotificationPreferencesModule`
- Add `WebPushService` to providers
- Inject `NotificationPreferencesService` and `WebPushService` into `NotificationDeliveryService`

### Step 3.4: Expose VAPID Public Key Endpoint

**File:** `apps/server/apps/gateway/src/push-subscription/push-subscription.controller.ts`

- `GET /v1/push-subscriptions/vapid-public-key` → returns VAPID public key (no auth required)
- Frontend needs this to call `pushManager.subscribe({ applicationServerKey })`

---

## Phase 4: Frontend — Service Worker

**Goal:** Create a Service Worker that receives Web Push events and shows OS notifications.

### Step 4.1: Install vite-plugin-pwa

```bash
cd apps/client && pnpm add -D vite-plugin-pwa
```

### Step 4.2: Create Service Worker

**File:** `apps/client/src/sw.ts`

```typescript
/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

// Tauri desktop app detection via localhost probe
const TAURI_HEALTH_URL = "http://127.0.0.1:19876/health";
let tauriActive = false;

async function probeTauri(): Promise<boolean> {
  try {
    const res = await fetch(TAURI_HEALTH_URL, {
      signal: AbortSignal.timeout(500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Periodic Tauri probe (every 30s)
setInterval(async () => {
  tauriActive = await probeTauri();
}, 30_000);
probeTauri().then((v) => {
  tauriActive = v;
});

// Handle push event
self.addEventListener("push", (event) => {
  const data = event.data?.json();
  if (!data) return;

  // Suppress if Tauri desktop app is active on this device
  if (tauriActive) return;

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body || "",
      icon: "/team9-block.png",
      badge: "/team9-badge.png",
      tag: data.id, // dedup by notification ID
      renotify: false,
      data: { actionUrl: data.actionUrl, id: data.id },
    }),
  );
});

// Handle notification click → navigate to actionUrl
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.actionUrl;
  if (!url) return;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus existing tab if available
        for (const client of clients) {
          if (client.url.includes(self.location.origin)) {
            client.focus();
            client.postMessage({ type: "NOTIFICATION_CLICK", actionUrl: url });
            return;
          }
        }
        // Otherwise open new tab
        return self.clients.openWindow(url);
      }),
  );
});
```

### Step 4.3: Configure Vite Plugin

**File:** `apps/client/vite.config.ts` — add `VitePWA` plugin:

```typescript
import { VitePWA } from "vite-plugin-pwa";

plugins: [
  // ...existing plugins
  VitePWA({
    srcDir: "src",
    filename: "sw.ts",
    strategies: "injectManifest",
    injectRegister: false, // We register manually
    manifest: false, // Not a PWA, just need the SW
    devOptions: { enabled: true, type: "module" },
  }),
];
```

### Step 4.4: Register Service Worker in App

**File:** `apps/client/src/lib/push-notifications.ts`

```typescript
import { isTauriApp } from "./tauri";

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (isTauriApp()) return null; // Tauri handles its own notifications
  if (!("serviceWorker" in navigator)) return null;
  if (!("PushManager" in window)) return null;

  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}
```

Call `registerServiceWorker()` in app initialization (e.g., `_authenticated.tsx` or `main.tsx`).

### Step 4.5: Handle NOTIFICATION_CLICK Message

In `useWebSocketEvents.ts` or a new `useServiceWorkerMessages` hook:

```typescript
navigator.serviceWorker?.addEventListener("message", (event) => {
  if (event.data?.type === "NOTIFICATION_CLICK") {
    navigate({ to: event.data.actionUrl });
  }
});
```

---

## Phase 5: Frontend — Push Subscription Management

**Goal:** Subscribe/unsubscribe the browser to Web Push based on user preference.

### Step 5.1: Push Subscription API Client

**File:** `apps/client/src/services/api/push-subscription.ts`

- `getVapidPublicKey()` → `GET /v1/push-subscriptions/vapid-public-key`
- `subscribe(subscription: PushSubscriptionJSON)` → `POST /v1/push-subscriptions`
- `unsubscribe(endpoint: string)` → `DELETE /v1/push-subscriptions`

### Step 5.2: Create usePushSubscription Hook

**File:** `apps/client/src/hooks/usePushSubscription.ts`

```typescript
export function usePushSubscription() {
  // subscribe(): request permission → pushManager.subscribe() → POST to server
  // unsubscribe(): pushManager.getSubscription()?.unsubscribe() → DELETE from server
  // status: 'unsupported' | 'denied' | 'default' | 'subscribed' | 'unsubscribed'
}
```

Key flow for `subscribe()`:

1. `Notification.requestPermission()` → if denied, return early
2. `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`
3. `pushSubscriptionApi.subscribe(subscription.toJSON())`

---

## Phase 6: Frontend — Notification Preferences UI

**Goal:** Add notification preferences dialog to Settings.

### Step 6.1: Notification Preferences API Client

**File:** `apps/client/src/services/api/notification-preferences.ts`

- `getPreferences()` → `GET /v1/notification-preferences`
- `updatePreferences(dto)` → `PATCH /v1/notification-preferences`

### Step 6.2: Create useNotificationPreferences Hook

**File:** `apps/client/src/hooks/useNotificationPreferences.ts`

- React Query: `queryKey: ['notificationPreferences']`
- `updatePreferences` mutation with optimistic update
- Connects to `usePushSubscription`: when `desktopEnabled` toggles on → subscribe; off → unsubscribe

### Step 6.3: Uncomment & Wire Up in MoreMainContent

**File:** `apps/client/src/components/layout/contents/MoreMainContent.tsx`

1. Uncomment line 42: `{ id: "notifications", label: "Notifications", icon: Bell }`
2. Add `Bell` to lucide-react imports
3. Add state: `const [isNotificationDialogOpen, setIsNotificationDialogOpen] = useState(false)`
4. Add handler: `else if (id === "notifications") { setIsNotificationDialogOpen(true); }`
5. Render `<NotificationPreferencesDialog>` component

### Step 6.4: Create NotificationPreferencesDialog

**File:** `apps/client/src/components/settings/NotificationPreferencesDialog.tsx`

UI structure (Dialog with sections):

```
┌─────────────────────────────────────┐
│  Notification Preferences           │
├─────────────────────────────────────┤
│  Desktop Notifications              │
│  [Switch: desktopEnabled]           │
│  ↳ Permission status / request btn  │
│                                     │
│  Mute when viewing channel          │
│  [Switch: focusSuppression]  (local)│
├─────────────────────────────────────┤
│  Notification Types                 │
│  Mentions     [Switch]              │
│  Replies      [Switch]              │
│  Direct Messages [Switch]           │
│  System       [Switch]              │
│  Workspace    [Switch]              │
├─────────────────────────────────────┤
│  Sound        [Switch]              │
├─────────────────────────────────────┤
│  Do Not Disturb                     │
│  [Switch: dndEnabled]               │
│  ↳ Start time / End time pickers    │
└─────────────────────────────────────┘
```

- Uses `Switch` component from `@/components/ui/switch`
- `focusSuppression` stored in localStorage (per-device), not synced to server
- `desktopEnabled` toggle triggers push subscription/unsubscription
- All other toggles → PATCH to notification preferences API

### Step 6.5: Add i18n Keys

**Files:** `apps/client/src/i18n/locales/{en,zh}/settings.json`

Add keys for all new labels (many already exist: `notifications`, `desktop`, `sound`).
New keys needed: `notificationPreferences`, `mentions`, `replies`, `directMessages`,
`system`, `workspace`, `doNotDisturb`, `muteWhenViewing`, `focusSuppression`, etc.

---

## Phase 7: Tauri — System Notifications

**Goal:** Show native system notifications in Tauri desktop app when `notification_new` arrives.

### Step 7.1: Add Dependencies

**Rust** (`apps/client/src-tauri/Cargo.toml`):

```toml
tauri-plugin-notification = "2"
```

**JS** (`apps/client/package.json`):

```bash
cd apps/client && pnpm add @tauri-apps/plugin-notification
```

### Step 7.2: Register Plugin

**File:** `apps/client/src-tauri/src/lib.rs`

Add to builder chain:

```rust
.plugin(tauri_plugin_notification::init())
```

### Step 7.3: Update Capabilities

**File:** `apps/client/src-tauri/capabilities/default.json`

Add to permissions array:

```json
"notification:default",
"notification:allow-is-permission-granted",
"notification:allow-request-permission",
"notification:allow-notify"
```

### Step 7.4: Create Tauri Notification Service

**File:** `apps/client/src/services/tauri-notification.ts`

```typescript
import { isTauriApp } from "@/lib/tauri";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export async function showTauriNotification(notification: {
  title: string;
  body?: string;
}): Promise<void> {
  if (!isTauriApp()) return;
  let granted = await isPermissionGranted();
  if (!granted) {
    const permission = await requestPermission();
    granted = permission === "granted";
  }
  if (granted) {
    sendNotification({ title: notification.title, body: notification.body });
  }
}
```

### Step 7.5: Hook into WebSocket Events

**File:** `apps/client/src/hooks/useWebSocketEvents.ts`

In `handleNotificationNew`, after adding to store:

```typescript
if (isTauriApp()) {
  // Check local preferences (focusSuppression, desktopEnabled)
  const prefs = getLocalNotificationPrefs();
  if (prefs.desktopEnabled && !shouldSuppress(event)) {
    showTauriNotification({ title: event.title, body: event.body });
  }
}
```

Focus suppression check: compare `event.channelId` with currently viewed channel ID.

---

## Phase 8: Tauri — Localhost Health Endpoint

**Goal:** Tauri app exposes `http://127.0.0.1:19876/health` so the Service Worker can detect same-device desktop app.

### Step 8.1: Add HTTP Server Dependencies

**File:** `apps/client/src-tauri/Cargo.toml`

```toml
axum = "0.8"
tokio = { version = "1", features = ["full"] }
```

Note: `tokio` may already be pulled in by tauri. Check if `axum` needs a specific tokio version.

### Step 8.2: Create Health Server Module

**File:** `apps/client/src-tauri/src/health_server.rs`

```rust
use axum::{routing::get, Router, Json};
use serde_json::json;
use std::net::SocketAddr;

async fn health_handler() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok", "app": "team9-desktop" }))
}

pub async fn start_health_server() {
    let app = Router::new()
        .route("/health", get(health_handler))
        .layer(/* CORS: allow origin * */);

    let addr = SocketAddr::from(([127, 0, 0, 1], 19876));
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.ok();
}
```

CORS middleware: add `tower-http` with `CorsLayer::permissive()` to allow cross-origin fetch from Service Worker.

### Step 8.3: Start on App Launch

**File:** `apps/client/src-tauri/src/lib.rs`

In the setup closure:

```rust
.setup(|app| {
    // Start health server in background
    tauri::async_runtime::spawn(health_server::start_health_server());
    Ok(())
})
```

Add `tower-http` to Cargo.toml:

```toml
tower-http = { version = "0.6", features = ["cors"] }
```

---

## Phase 9: Focus Suppression

**Goal:** Optionally suppress notifications for the channel the user is currently viewing.

### Step 9.1: Track Current Active Channel

The app already tracks the current route via TanStack Router. We need a lightweight way for the notification logic to check "is the user looking at this channel right now?"

**Option:** Export a `getCurrentViewingChannelId()` function from the router or a small Zustand slice. The `useMessages` hook already knows the active `channelId`; expose it via a module-level variable or a tiny store.

### Step 9.2: Focus Suppression Preference

- Stored in `localStorage` (per-device, not synced to server)
- Key: `notification_focus_suppression` (default: `true`)
- Exposed via `getLocalNotificationPrefs()` utility
- Checked in:
  - **Service Worker**: SW receives `channelId` in push payload; post a message to active client asking "are you viewing this channel?" — if yes, suppress. Alternatively, include `document.visibilityState` check.
  - **Tauri**: Direct check in `useWebSocketEvents` before calling `showTauriNotification()`

Note: For the Service Worker, precise focus suppression is tricky since SW can't access DOM. Two approaches:

1. **Simple**: SW always shows notification; active tab hides it via `getNotifications()` + `close()` if user is viewing that channel (race condition but acceptable)
2. **Better**: Active tab sends periodic heartbeat to SW via `postMessage` with current channelId. SW checks before showing.

We'll go with approach 2: active tab posts `{ type: 'HEARTBEAT', channelId, visible }` every 5s. SW stores latest state.

---

## Phase 10: Testing

### Backend Tests

**Step 10.1: NotificationPreferencesService tests**

- `notification-preferences.service.spec.ts`
- Test: get default preferences for new user, upsert, partial update, shouldNotify logic

**Step 10.2: PushSubscriptionService tests**

- `push-subscription.service.spec.ts`
- Test: subscribe, unsubscribe, duplicate endpoint handling, cleanup stale

**Step 10.3: WebPushService tests**

- `web-push.service.spec.ts`
- Mock `web-push` library, test: send success, 410 cleanup, error handling, disabled when no VAPID

**Step 10.4: NotificationDeliveryService integration**

- Update existing `notification-delivery.service.spec.ts`
- Test: preferences filtering, web push called alongside WebSocket, disabled features skipped

### Frontend Tests

**Step 10.5: NotificationPreferencesDialog tests**

- Render, toggle switches, API calls, push subscription flow

**Step 10.6: usePushSubscription hook tests**

- Mock navigator.serviceWorker, PushManager, API calls

**Step 10.7: Service Worker tests**

- Mock push events, Tauri probe, notification display, click handling

**Step 10.8: Tauri notification tests**

- Mock @tauri-apps/plugin-notification, test permission flow, focus suppression

---

## Implementation Order & Dependencies

```
Phase 1 (Preferences API) ──┐
                             ├──→ Phase 3 (Web Push Delivery) ──→ Phase 4 (Service Worker)
Phase 2 (Push Subscription) ─┘                                         │
                                                                        ▼
                                                              Phase 5 (Push Sub Mgmt)
                                                                        │
Phase 7 (Tauri Notifications) ─────────────────────────────────┐       │
Phase 8 (Tauri Health Server) ─────────────────────────────────┤       │
                                                                ▼       ▼
                                                         Phase 6 (Preferences UI)
                                                                │
                                                                ▼
                                                         Phase 9 (Focus Suppression)
                                                                │
                                                                ▼
                                                         Phase 10 (Testing)
```

**Parallelizable:**

- Phase 1 + Phase 2 (independent backend modules)
- Phase 7 + Phase 8 (Tauri-only, independent of backend push)
- Phase 4 + Phase 7 (Service Worker and Tauri notification, different platforms)

**Critical Path:** Phase 1 → Phase 3 → Phase 4 → Phase 5 → Phase 6

---

## Files Created (New)

| File                                                                                      | Phase |
| ----------------------------------------------------------------------------------------- | ----- |
| `server/apps/gateway/src/notification-preferences/notification-preferences.service.ts`    | 1     |
| `server/apps/gateway/src/notification-preferences/notification-preferences.controller.ts` | 1     |
| `server/apps/gateway/src/notification-preferences/notification-preferences.module.ts`     | 1     |
| `server/apps/gateway/src/notification-preferences/dto/*.ts`                               | 1     |
| `server/libs/database/src/schemas/im/push-subscriptions.ts`                               | 2     |
| `server/apps/gateway/src/push-subscription/push-subscription.service.ts`                  | 2     |
| `server/apps/gateway/src/push-subscription/push-subscription.controller.ts`               | 2     |
| `server/apps/gateway/src/push-subscription/push-subscription.module.ts`                   | 2     |
| `server/apps/gateway/src/notification/web-push.service.ts`                                | 3     |
| `client/src/sw.ts`                                                                        | 4     |
| `client/src/lib/push-notifications.ts`                                                    | 4     |
| `client/src/services/api/push-subscription.ts`                                            | 5     |
| `client/src/hooks/usePushSubscription.ts`                                                 | 5     |
| `client/src/services/api/notification-preferences.ts`                                     | 6     |
| `client/src/hooks/useNotificationPreferences.ts`                                          | 6     |
| `client/src/components/settings/NotificationPreferencesDialog.tsx`                        | 6     |
| `client/src/services/tauri-notification.ts`                                               | 7     |
| `client/src-tauri/src/health_server.rs`                                                   | 8     |

## Files Modified (Existing)

| File                                                                    | Phase | Change                                            |
| ----------------------------------------------------------------------- | ----- | ------------------------------------------------- |
| `server/.env.example`                                                   | 2     | Add VAPID vars                                    |
| `server/libs/shared/src/env.ts`                                         | 2     | Add VAPID getters                                 |
| `server/libs/database/src/schemas/im/index.ts`                          | 2     | Export push-subscriptions                         |
| `server/apps/gateway/src/app.module.ts`                                 | 1,2   | Import new modules                                |
| `server/apps/gateway/src/notification/notification-delivery.service.ts` | 3     | Add push + preferences check                      |
| `server/apps/gateway/src/notification/notification.module.ts`           | 3     | Import new services                               |
| `client/vite.config.ts`                                                 | 4     | Add VitePWA plugin                                |
| `client/src/hooks/useWebSocketEvents.ts`                                | 7     | Add Tauri notification trigger                    |
| `client/src/components/layout/contents/MoreMainContent.tsx`             | 6     | Uncomment notifications, add dialog               |
| `client/src/i18n/locales/en/settings.json`                              | 6     | Add i18n keys                                     |
| `client/src/i18n/locales/zh/settings.json`                              | 6     | Add i18n keys                                     |
| `client/src-tauri/Cargo.toml`                                           | 7,8   | Add notification plugin, axum, tower-http         |
| `client/src-tauri/src/lib.rs`                                           | 7,8   | Register notification plugin, start health server |
| `client/src-tauri/capabilities/default.json`                            | 7     | Add notification permissions                      |
| `client/package.json`                                                   | 7     | Add @tauri-apps/plugin-notification               |
