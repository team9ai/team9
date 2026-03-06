# Sentry Integration Design

## Decision

**Approach:** Official Sentry SDK direct integration (no shared wrapper library, no OpenTelemetry).

**Scope:** Full-stack — NestJS Gateway, IM Worker, React/Tauri client.

**Features:** Error monitoring + Performance tracing + Session Replay (on error only).

**Environments:** dev, production (staging to be added later). Sentry disabled when DSN not set.

---

## Backend: Gateway + IM Worker

### Package

```
@sentry/nestjs
@sentry/profiling-node
```

### Initialization

Each app (gateway, im-worker) creates an `instrument.ts` file imported at the top of `main.ts` before any NestJS bootstrap code:

```ts
// apps/server/apps/{gateway,im-worker}/src/instrument.ts
import * as Sentry from "@sentry/nestjs";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || "development",
  enabled: !!process.env.SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
  profilesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  integrations: [nodeProfilingIntegration()],
});
```

Then in `main.ts`:

```ts
import "./instrument";
// ... rest of bootstrap
```

### NestJS Module Integration

In each app's `AppModule`:

```ts
import { SentryModule } from "@sentry/nestjs/setup";

@Module({
  imports: [SentryModule.forRoot() /* ...existing modules */],
})
export class AppModule {}
```

### Global Exception Filter

Register `SentryGlobalFilter` as the global exception filter:

```ts
import { SentryGlobalFilter } from "@sentry/nestjs/setup";
import { APP_FILTER } from "@nestjs/core";

@Module({
  providers: [{ provide: APP_FILTER, useClass: SentryGlobalFilter }],
})
export class AppModule {}
```

For WebSocket exceptions in gateway, add `SentryGlobalGenericFilter` to the WebSocket gateway.

### User Context

After JWT auth guard resolves the user, set Sentry user context:

```ts
Sentry.setUser({ id: user.id, email: user.email });
```

This can be done in a NestJS interceptor that runs after auth.

### Environment Variables

```env
SENTRY_DSN=https://xxx@sentry.io/xxx
SENTRY_AUTH_TOKEN=sntrys_xxx  # For source map upload in CI
NODE_ENV=production           # Already exists
```

---

## Frontend: React + Tauri Client

### Packages

```
@sentry/react
@sentry/vite-plugin
```

### Initialization

In `apps/client/src/main.tsx`, before `ReactDOM.createRoot()`:

```ts
import * as Sentry from "@sentry/react";

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
```

### React Error Boundary

Wrap the root app component:

```tsx
<Sentry.ErrorBoundary fallback={<ErrorFallback />}>
  <App />
</Sentry.ErrorBoundary>
```

Create a simple `ErrorFallback` component showing a user-friendly error message with a reload button.

### TanStack Router Integration

TanStack Router doesn't have built-in Sentry integration. Manually track navigation:

- Use router's `subscribe` method to listen for route changes
- Call `Sentry.startBrowserTracingNavigationSpan()` on each navigation

### HTTP Client Integration

In the existing error interceptor at `apps/client/src/services/http/interceptors.ts`:

```ts
Sentry.captureException(error, {
  tags: { url: request.url, status: response?.status },
});
```

### WebSocket Error Tracking

In `apps/client/src/services/websocket/index.ts`, on `connect_error` and unhandled events:

```ts
Sentry.captureException(error, { tags: { type: "websocket" } });
```

Add Sentry breadcrumbs for WebSocket events (connect, disconnect, reconnect) to aid debugging.

### Source Map Upload

In `apps/client/vite.config.ts`:

```ts
import { sentryVitePlugin } from "@sentry/vite-plugin";

export default defineConfig({
  build: { sourcemap: true },
  plugins: [
    // ...existing plugins
    sentryVitePlugin({
      org: "<sentry-org>",
      project: "team9-client",
      authToken: process.env.SENTRY_AUTH_TOKEN,
    }),
  ],
});
```

Source maps are uploaded during build and **not** served to the browser (Sentry deletes them after processing or they can be configured to not emit).

### User Context

After login:

```ts
Sentry.setUser({ id: user.id, email: user.email });
```

On logout:

```ts
Sentry.setUser(null);
```

### Environment Variables

```env
VITE_SENTRY_DSN=https://xxx@sentry.io/xxx
```

---

## Sampling Strategy

| Environment | Error Rate | Traces Rate | Profiles Rate | Replay (on error) |
| ----------- | ---------- | ----------- | ------------- | ----------------- |
| development | 100%       | 100%        | 100%          | 100%              |
| production  | 100%       | 20%         | 10%           | 100%              |

These rates are configurable via environment variables if needed later.

---

## Sentry Project Setup

Two Sentry projects recommended:

1. **team9-server** — receives events from both gateway and im-worker (distinguished by `serverName` tag)
2. **team9-client** — receives events from the React/Tauri frontend

Both under the same Sentry organization for cross-project trace correlation.

---

## Files to Create/Modify

### New Files

- `apps/server/apps/gateway/src/instrument.ts` — Sentry init for gateway
- `apps/server/apps/im-worker/src/instrument.ts` — Sentry init for im-worker
- `apps/client/src/components/error-fallback.tsx` — Error boundary fallback UI

### Modified Files

- `apps/server/apps/gateway/src/main.ts` — import instrument.ts
- `apps/server/apps/im-worker/src/main.ts` — import instrument.ts
- `apps/server/apps/gateway/src/app.module.ts` — add SentryModule, SentryGlobalFilter
- `apps/server/apps/im-worker/src/app.module.ts` — add SentryModule, SentryGlobalFilter
- `apps/client/src/main.tsx` — Sentry.init + ErrorBoundary
- `apps/client/src/services/http/interceptors.ts` — add Sentry.captureException
- `apps/client/src/services/websocket/index.ts` — add Sentry error tracking + breadcrumbs
- `apps/client/vite.config.ts` — add sentryVitePlugin + sourcemap: true
- `apps/server/.env.example` — add SENTRY_DSN
- `apps/client/.env.example` — add VITE_SENTRY_DSN
- `apps/server/apps/gateway/package.json` — add @sentry/nestjs
- `apps/server/apps/im-worker/package.json` — add @sentry/nestjs
- `apps/client/package.json` — add @sentry/react, @sentry/vite-plugin
