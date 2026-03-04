# Sentry Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add full-stack Sentry monitoring (error tracking + performance tracing + session replay) to the Team9 platform.

**Architecture:** Official Sentry SDKs integrated directly into each app — `@sentry/nestjs` for Gateway and IM Worker, `@sentry/react` + `@sentry/vite-plugin` for the React/Tauri client. Sentry auto-disables when DSN env var is not set.

**Tech Stack:** @sentry/nestjs, @sentry/profiling-node, @sentry/react, @sentry/vite-plugin

**Design doc:** `docs/plans/2026-02-26-sentry-integration-design.md`

---

### Task 1: Install Backend Sentry Dependencies

**Files:**

- Modify: `apps/server/apps/gateway/package.json`
- Modify: `apps/server/apps/im-worker/package.json`

**Step 1: Install packages in gateway workspace**

```bash
pnpm add @sentry/nestjs @sentry/profiling-node --filter gateway
```

**Step 2: Install packages in im-worker workspace**

```bash
pnpm add @sentry/nestjs @sentry/profiling-node --filter im-worker
```

**Step 3: Verify installation**

```bash
pnpm ls @sentry/nestjs --filter gateway
pnpm ls @sentry/nestjs --filter im-worker
```

Expected: Both show `@sentry/nestjs` installed.

**Step 4: Commit**

```bash
git add apps/server/apps/gateway/package.json apps/server/apps/im-worker/package.json pnpm-lock.yaml
git commit -m "chore: add @sentry/nestjs and @sentry/profiling-node to backend services"
```

---

### Task 2: Add Sentry Instrumentation to Gateway

**Files:**

- Create: `apps/server/apps/gateway/src/instrument.ts`
- Modify: `apps/server/apps/gateway/src/main.ts` (line 1)
- Modify: `apps/server/apps/gateway/src/app.module.ts`

**Step 1: Create `instrument.ts` for gateway**

Create file `apps/server/apps/gateway/src/instrument.ts`:

```ts
import * as Sentry from "@sentry/nestjs";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  enabled: !!process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
  profilesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  integrations: [nodeProfilingIntegration()],
  serverName: "gateway",
});
```

**Step 2: Import instrument.ts at the very top of `main.ts`**

The first line is currently:

```ts
import "./load-env.js"; // Load environment variables first
```

Add the Sentry instrument import right after it (Sentry must init after env vars are loaded but before everything else):

```ts
import "./load-env.js"; // Load environment variables first
import "./instrument.js"; // Initialize Sentry before any other imports
```

**Step 3: Add SentryModule and SentryGlobalFilter to `app.module.ts`**

Add imports at top of `apps/server/apps/gateway/src/app.module.ts`:

```ts
import { SentryModule } from "@sentry/nestjs/setup";
import { SentryGlobalFilter } from "@sentry/nestjs/setup";
import { APP_FILTER } from "@nestjs/core";
```

Add `SentryModule.forRoot()` as first item in the `@Module` imports array:

```ts
imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({
    // ...
```

Add `SentryGlobalFilter` to providers array:

```ts
providers: [AppService, { provide: APP_FILTER, useClass: SentryGlobalFilter }],
```

**Step 4: Verify the server starts**

```bash
pnpm dev:server
```

Expected: Gateway starts without errors on port 3000. No Sentry errors (DSN not set = disabled).

**Step 5: Commit**

```bash
git add apps/server/apps/gateway/src/instrument.ts apps/server/apps/gateway/src/main.ts apps/server/apps/gateway/src/app.module.ts
git commit -m "feat(gateway): integrate Sentry error monitoring and performance tracing"
```

---

### Task 3: Add Sentry Instrumentation to IM Worker

**Files:**

- Create: `apps/server/apps/im-worker/src/instrument.ts`
- Modify: `apps/server/apps/im-worker/src/main.ts` (line 1)
- Modify: `apps/server/apps/im-worker/src/app.module.ts`

**Step 1: Create `instrument.ts` for im-worker**

Create file `apps/server/apps/im-worker/src/instrument.ts`:

```ts
import * as Sentry from "@sentry/nestjs";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  enabled: !!process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
  profilesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  integrations: [nodeProfilingIntegration()],
  serverName: "im-worker",
});
```

**Step 2: Import instrument.ts at the top of `main.ts`**

Currently the first line is:

```ts
import { NestFactory } from "@nestjs/core";
```

Add Sentry instrument import before it:

```ts
import "./instrument.js"; // Initialize Sentry before any other imports
import { NestFactory } from "@nestjs/core";
```

**Step 3: Add SentryModule and SentryGlobalFilter to `app.module.ts`**

Add imports at top of `apps/server/apps/im-worker/src/app.module.ts`:

```ts
import { SentryModule } from "@sentry/nestjs/setup";
import { SentryGlobalFilter } from "@sentry/nestjs/setup";
import { APP_FILTER } from "@nestjs/core";
```

Add `SentryModule.forRoot()` as first item in imports array:

```ts
imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({
    // ...
```

Add providers array to the `@Module` decorator:

```ts
@Module({
  imports: [ /* ... */ ],
  providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }],
})
```

**Step 4: Verify im-worker starts**

```bash
pnpm dev:im-worker
```

Expected: IM Worker starts without errors on port 3001.

**Step 5: Commit**

```bash
git add apps/server/apps/im-worker/src/instrument.ts apps/server/apps/im-worker/src/main.ts apps/server/apps/im-worker/src/app.module.ts
git commit -m "feat(im-worker): integrate Sentry error monitoring and performance tracing"
```

---

### Task 4: Add Backend Sentry User Context Interceptor

**Files:**

- Create: `apps/server/apps/gateway/src/common/interceptors/sentry-user.interceptor.ts`
- Modify: `apps/server/apps/gateway/src/app.module.ts`

**Step 1: Create the Sentry user context interceptor**

Create file `apps/server/apps/gateway/src/common/interceptors/sentry-user.interceptor.ts`:

```ts
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable } from "rxjs";
import * as Sentry from "@sentry/nestjs";

@Injectable()
export class SentryUserInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (user) {
      Sentry.setUser({
        id: user.id || user.sub,
        email: user.email,
      });
    }

    return next.handle();
  }
}
```

**Step 2: Register as global interceptor in `app.module.ts`**

Add imports to `apps/server/apps/gateway/src/app.module.ts`:

```ts
import { APP_INTERCEPTOR } from "@nestjs/core";
import { SentryUserInterceptor } from "./common/interceptors/sentry-user.interceptor.js";
```

Update providers:

```ts
providers: [
  AppService,
  { provide: APP_FILTER, useClass: SentryGlobalFilter },
  { provide: APP_INTERCEPTOR, useClass: SentryUserInterceptor },
],
```

**Step 3: Verify server starts**

```bash
pnpm dev:server
```

Expected: Starts without errors.

**Step 4: Commit**

```bash
git add apps/server/apps/gateway/src/common/interceptors/sentry-user.interceptor.ts apps/server/apps/gateway/src/app.module.ts
git commit -m "feat(gateway): add Sentry user context interceptor for authenticated requests"
```

---

### Task 5: Update Backend Environment Variable Examples

**Files:**

- Modify: `apps/server/.env.example`

**Step 1: Add Sentry env vars to `.env.example`**

Append to end of `apps/server/.env.example`:

```env

# Sentry Configuration (optional - monitoring disabled when not set)
# SENTRY_DSN=https://xxx@xxx.ingest.us.sentry.io/xxx
```

**Step 2: Commit**

```bash
git add apps/server/.env.example
git commit -m "docs: add SENTRY_DSN to server .env.example"
```

---

### Task 6: Install Frontend Sentry Dependencies

**Files:**

- Modify: `apps/client/package.json`

**Step 1: Install packages**

```bash
pnpm add @sentry/react --filter client
pnpm add -D @sentry/vite-plugin --filter client
```

**Step 2: Verify installation**

```bash
pnpm ls @sentry/react --filter client
pnpm ls @sentry/vite-plugin --filter client
```

Expected: Both packages installed.

**Step 3: Commit**

```bash
git add apps/client/package.json pnpm-lock.yaml
git commit -m "chore: add @sentry/react and @sentry/vite-plugin to client"
```

---

### Task 7: Initialize Sentry in React Client + Error Boundary

**Files:**

- Create: `apps/client/src/components/error-fallback.tsx`
- Modify: `apps/client/src/main.tsx`

**Step 1: Create ErrorFallback component**

Create file `apps/client/src/components/error-fallback.tsx`:

```tsx
export function ErrorFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-semibold text-foreground">
          Something went wrong
        </h1>
        <p className="text-muted-foreground">
          An unexpected error occurred. Please try refreshing the page.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90"
        >
          Refresh Page
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Add Sentry init and ErrorBoundary to `main.tsx`**

The full updated `apps/client/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import * as Sentry from "@sentry/react";
import TagManager from "react-gtm-module";
import { GoogleOAuthProvider } from "@react-oauth/google";
import "./global.css";
import "./i18n";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { routeTree } from "./routeTree.gen";
import { queryClient } from "./lib/query-client";
import { ErrorFallback } from "./components/error-fallback";

// Initialize Sentry
Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_DSN,
  environment: import.meta.env.MODE,
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration(),
  ],
  tracesSampleRate: import.meta.env.PROD ? 0.2 : 1.0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
});

// Initialize Google Tag Manager
const gtmId = import.meta.env.VITE_GTM_ID;
if (gtmId) {
  TagManager.initialize({ gtmId });
}

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const AppProviders = ({ children }: { children: React.ReactNode }) => {
  if (googleClientId) {
    return (
      <GoogleOAuthProvider clientId={googleClientId}>
        {children}
      </GoogleOAuthProvider>
    );
  }
  return <>{children}</>;
};

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <QueryClientProvider client={queryClient}>
        <AppProviders>
          <RouterProvider router={router} />
        </AppProviders>
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);
```

**Step 3: Verify client starts**

```bash
pnpm dev:client
```

Expected: Dev server starts on port 1420, no errors.

**Step 4: Commit**

```bash
git add apps/client/src/components/error-fallback.tsx apps/client/src/main.tsx
git commit -m "feat(client): initialize Sentry with error boundary and session replay"
```

---

### Task 8: Add Sentry to HTTP Error Interceptor

**Files:**

- Modify: `apps/client/src/services/http/interceptors.ts` (line 75-85)

**Step 1: Add Sentry import and update `errorLogger`**

Add import at top of `apps/client/src/services/http/interceptors.ts`:

```ts
import * as Sentry from "@sentry/react";
```

Replace the `errorLogger` function (line 75-85) with:

```ts
export const errorLogger = async (error: HttpError): Promise<never> => {
  // Report to Sentry (skip 401 as those are handled by auth refresh)
  if (error.status !== 401) {
    Sentry.captureException(error, {
      tags: {
        url: error.config?.url,
        method: error.config?.method,
        status: error.status?.toString(),
      },
    });
  }

  if (import.meta.env.DEV) {
    console.error("[HTTP Error]", {
      message: error.message,
      status: error.status,
      code: error.code,
      response: error.response?.data,
    });
  }
  throw error;
};
```

**Step 2: Verify client still works**

```bash
pnpm dev:client
```

**Step 3: Commit**

```bash
git add apps/client/src/services/http/interceptors.ts
git commit -m "feat(client): report HTTP errors to Sentry"
```

---

### Task 9: Add Sentry to WebSocket Error Tracking

**Files:**

- Modify: `apps/client/src/services/websocket/index.ts`

**Step 1: Add Sentry import**

Add import at top of file:

```ts
import * as Sentry from "@sentry/react";
```

**Step 2: Add breadcrumbs and error reporting in `setupEventHandlers`**

In the `connect` handler (~line 108), add breadcrumb after `this.reconnectAttempts = 0;`:

```ts
Sentry.addBreadcrumb({
  category: "websocket",
  message: "WebSocket connected",
  level: "info",
});
```

In the `disconnect` handler (~line 118), add breadcrumb after `this.isConnecting = false;`:

```ts
Sentry.addBreadcrumb({
  category: "websocket",
  message: `WebSocket disconnected: ${reason}`,
  level: "warning",
});
```

In the `connect_error` handler (~line 123), add after `this.reconnectAttempts++;`:

```ts
Sentry.captureException(error, {
  tags: { type: "websocket", event: "connect_error" },
});
```

In the `auth_error` handler (~line 140), add before `this.disconnect();`:

```ts
Sentry.captureException(
  new Error(`WebSocket auth error: ${JSON.stringify(error)}`),
  { tags: { type: "websocket", event: "auth_error" } },
);
```

In the `reconnect_failed` handler (~line 151), add:

```ts
Sentry.captureException(
  new Error("WebSocket reconnection failed after max attempts"),
  { tags: { type: "websocket", event: "reconnect_failed" } },
);
```

**Step 3: Verify client still works**

```bash
pnpm dev:client
```

**Step 4: Commit**

```bash
git add apps/client/src/services/websocket/index.ts
git commit -m "feat(client): add Sentry error tracking and breadcrumbs to WebSocket service"
```

---

### Task 10: Add Sentry User Context on Login/Logout

**Files:**

- Explore and modify: login/logout handlers in the client

**Step 1: Find login/logout handlers**

Search for where auth tokens are stored/removed:

```bash
grep -rn "setItem.*auth_token" apps/client/src/ --include="*.ts" --include="*.tsx"
grep -rn "removeItem.*auth_token" apps/client/src/ --include="*.ts" --include="*.tsx"
```

**Step 2: Add `Sentry.setUser()` after login success**

Where auth token is stored and user data is available, add:

```ts
import * as Sentry from "@sentry/react";
Sentry.setUser({ id: user.id, email: user.email });
```

**Step 3: Add `Sentry.setUser(null)` on logout**

Where auth tokens are removed, add:

```ts
Sentry.setUser(null);
```

**Step 4: Commit**

```bash
git add <modified-files>
git commit -m "feat(client): set Sentry user context on login/logout"
```

---

### Task 11: Configure Vite Source Map Upload

**Files:**

- Modify: `apps/client/vite.config.ts`

**Step 1: Add sentryVitePlugin to vite config**

Add import at top of `apps/client/vite.config.ts`:

```ts
import { sentryVitePlugin } from "@sentry/vite-plugin";
```

Add `sourcemap: true` to the `build` section:

```ts
build: {
    sourcemap: true,
    rollupOptions: {
```

Add `sentryVitePlugin` to the end of the plugins array:

```ts
plugins: [
  tanstackRouter(),
  react(),
  tailwindcss(),
  sentryVitePlugin({
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    disable: !process.env.SENTRY_AUTH_TOKEN,
  }),
],
```

Note: `disable: !process.env.SENTRY_AUTH_TOKEN` ensures source map upload only runs in CI.

**Step 2: Verify dev server still works**

```bash
pnpm dev:client
```

**Step 3: Commit**

```bash
git add apps/client/vite.config.ts
git commit -m "feat(client): configure Sentry Vite plugin for source map upload"
```

---

### Task 12: Update Frontend Environment Variable Examples

**Files:**

- Modify: `apps/client/.env.example`

**Step 1: Add Sentry env var**

Append to `apps/client/.env.example`:

```env
VITE_SENTRY_DSN=
```

**Step 2: Commit**

```bash
git add apps/client/.env.example
git commit -m "docs: add VITE_SENTRY_DSN to client .env.example"
```

---

### Task 13: Final Verification

**Step 1: Start full dev environment**

```bash
pnpm dev
```

Expected: Both server (gateway + im-worker) and client start without errors.

**Step 2: Verify no TypeScript errors**

```bash
pnpm build:server
pnpm build:client
```

Expected: Both build successfully.

**Step 3: Squash commit if needed**

If all steps built cleanly, no additional commit needed. Otherwise:

```bash
git add -A
git commit -m "fix: address build issues from Sentry integration"
```
