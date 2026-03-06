# Grafana Observability Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add full observability (Metrics, Logs, Traces) to Gateway and im-worker via OpenTelemetry SDK, pushing to Grafana Cloud over OTLP.

**Architecture:** A new `@team9/observability` shared library initializes the OTel NodeSDK before NestJS boots (mirroring the existing Sentry `instrument.ts` pattern). Auto-instrumentation captures HTTP/Express/NestJS/Socket.io/PG/Redis traces. Custom business metrics (WS connections, messages, online users) are defined in the library and instrumented at specific code points. A custom NestJS Logger sends structured logs via OTel LoggerProvider.

**Tech Stack:** `@opentelemetry/sdk-node`, OTLP exporters (proto), `@opentelemetry/auto-instrumentations-node`, Grafana Cloud

**Design Doc:** `docs/plans/2026-03-04-grafana-observability-design.md`

---

### Task 1: Create `@team9/observability` library scaffold

**Files:**

- Create: `apps/server/libs/observability/package.json`
- Create: `apps/server/libs/observability/tsconfig.json`
- Create: `apps/server/libs/observability/src/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "@team9/observability",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "source": "./src/index.ts",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@opentelemetry/api": "^1.9.0",
    "@opentelemetry/api-logs": "^0.57.0",
    "@opentelemetry/sdk-node": "^0.57.0",
    "@opentelemetry/sdk-metrics": "^1.30.0",
    "@opentelemetry/sdk-logs": "^0.57.0",
    "@opentelemetry/exporter-trace-otlp-proto": "^0.57.0",
    "@opentelemetry/exporter-metrics-otlp-proto": "^0.57.0",
    "@opentelemetry/exporter-logs-otlp-proto": "^0.57.0",
    "@opentelemetry/auto-instrumentations-node": "^0.56.0",
    "@opentelemetry/instrumentation-nestjs-core": "^0.44.0",
    "@opentelemetry/instrumentation-socket.io": "^0.46.0",
    "@opentelemetry/resources": "^1.30.0",
    "@opentelemetry/semantic-conventions": "^1.30.0",
    "@nestjs/common": "^11.0.1"
  },
  "devDependencies": {
    "typescript": "^5.7.3"
  }
}
```

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "baseUrl": "."
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create placeholder src/index.ts**

```typescript
// @team9/observability - OpenTelemetry integration for Grafana Cloud
export {};
```

**Step 4: Install dependencies**

Run: `cd apps/server && pnpm install`

**Step 5: Add path alias to server tsconfig**

Modify: `apps/server/tsconfig.json` — add to `paths`:

```json
"@team9/observability": ["libs/observability/src"],
"@team9/observability/*": ["libs/observability/src/*"]
```

Also add the same aliases to:

- `apps/server/apps/gateway/tsconfig.json` with `../../libs/observability/src` path
- `apps/server/apps/im-worker/tsconfig.json` (check if exists, mirror gateway pattern)

**Step 6: Verify build**

Run: `cd apps/server/libs/observability && pnpm build`
Expected: Compiles with no errors.

**Step 7: Commit**

```bash
git add apps/server/libs/observability/ apps/server/tsconfig.json apps/server/apps/gateway/tsconfig.json
git commit -m "feat(observability): scaffold @team9/observability shared library"
```

---

### Task 2: Implement OTel SDK initialization (`otel.ts`)

**Files:**

- Create: `apps/server/libs/observability/src/otel.ts`
- Modify: `apps/server/libs/observability/src/index.ts`

**Step 1: Create otel.ts**

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-proto";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Resource } from "@opentelemetry/resources";
import {
  ATTR_SERVICE_NAME,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} from "@opentelemetry/semantic-conventions";

let sdk: NodeSDK | null = null;

export function initOtel(serviceName: string): void {
  const enabled = process.env.OTEL_ENABLED === "true";
  if (!enabled) {
    return;
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const token = process.env.GRAFANA_CLOUD_TOKEN;

  if (!endpoint || !token) {
    console.warn(
      "[OTel] OTEL_ENABLED=true but OTEL_EXPORTER_OTLP_ENDPOINT or GRAFANA_CLOUD_TOKEN is missing. Skipping.",
    );
    return;
  }

  const headers = { Authorization: `Basic ${token}` };
  const environment = process.env.NODE_ENV || "development";

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: environment,
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
    headers,
  });

  const metricExporter = new OTLPMetricExporter({
    url: `${endpoint}/v1/metrics`,
    headers,
  });

  const logExporter = new OTLPLogExporter({
    url: `${endpoint}/v1/logs`,
    headers,
  });

  sdk = new NodeSDK({
    resource,
    traceExporter,
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 15_000,
    }),
    logRecordProcessor: new BatchLogRecordProcessor(logExporter),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable fs instrumentation to reduce noise
        "@opentelemetry/instrumentation-fs": { enabled: false },
        // Disable DNS to reduce noise
        "@opentelemetry/instrumentation-dns": { enabled: false },
      }),
    ],
  });

  sdk.start();
  console.log(`[OTel] OpenTelemetry initialized for service: ${serviceName}`);

  // Graceful shutdown
  const shutdown = async () => {
    if (sdk) {
      await sdk.shutdown();
      console.log("[OTel] OpenTelemetry shut down");
    }
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
```

**Step 2: Update index.ts**

```typescript
export { initOtel } from "./otel.js";
```

**Step 3: Verify build**

Run: `cd apps/server/libs/observability && pnpm build`
Expected: Compiles with no errors.

**Step 4: Commit**

```bash
git add apps/server/libs/observability/src/
git commit -m "feat(observability): implement OTel SDK initialization with OTLP exporters"
```

---

### Task 3: Implement custom business metrics

**Files:**

- Create: `apps/server/libs/observability/src/metrics.ts`
- Modify: `apps/server/libs/observability/src/index.ts`

**Step 1: Create metrics.ts**

```typescript
import {
  metrics,
  type Counter,
  type Histogram,
  type UpDownCounter,
} from "@opentelemetry/api";

const METER_NAME = "team9";

let _meter: ReturnType<typeof metrics.getMeter> | null = null;

function getMeter() {
  if (!_meter) {
    _meter = metrics.getMeter(METER_NAME);
  }
  return _meter;
}

// Lazy-initialized metric instances
let _wsConnections: UpDownCounter | null = null;
let _messagesTotal: Counter | null = null;
let _messageLatency: Histogram | null = null;
let _onlineUsers: UpDownCounter | null = null;

export const appMetrics = {
  get wsConnections(): UpDownCounter {
    if (!_wsConnections) {
      _wsConnections = getMeter().createUpDownCounter("ws.connections", {
        description: "Active WebSocket connections",
      });
    }
    return _wsConnections;
  },

  get messagesTotal(): Counter {
    if (!_messagesTotal) {
      _messagesTotal = getMeter().createCounter("im.messages.total", {
        description: "Total messages processed",
      });
    }
    return _messagesTotal;
  },

  get messageLatency(): Histogram {
    if (!_messageLatency) {
      _messageLatency = getMeter().createHistogram("im.messages.duration_ms", {
        description: "Message processing latency in milliseconds",
        unit: "ms",
      });
    }
    return _messageLatency;
  },

  get onlineUsers(): UpDownCounter {
    if (!_onlineUsers) {
      _onlineUsers = getMeter().createUpDownCounter("users.online", {
        description: "Currently online users",
      });
    }
    return _onlineUsers;
  },
};
```

**Step 2: Update index.ts**

```typescript
export { initOtel } from "./otel.js";
export { appMetrics } from "./metrics.js";
```

**Step 3: Verify build**

Run: `cd apps/server/libs/observability && pnpm build`
Expected: Compiles with no errors.

**Step 4: Commit**

```bash
git add apps/server/libs/observability/src/
git commit -m "feat(observability): add custom business metric definitions"
```

---

### Task 4: Implement OTel-backed NestJS Logger

**Files:**

- Create: `apps/server/libs/observability/src/otel-logger.ts`
- Modify: `apps/server/libs/observability/src/index.ts`

**Step 1: Create otel-logger.ts**

```typescript
import { LoggerService, LogLevel } from "@nestjs/common";
import { logs, SeverityNumber } from "@opentelemetry/api-logs";

export class OtelLogger implements LoggerService {
  private readonly logger = logs.getLogger("nestjs");

  log(message: string, context?: string): void {
    this.logger.emit({
      severityNumber: SeverityNumber.INFO,
      severityText: "INFO",
      body: message,
      attributes: context ? { context } : undefined,
    });
    // Also write to console for local visibility
    console.log(`[${context ?? "App"}] ${message}`);
  }

  error(message: string, trace?: string, context?: string): void {
    this.logger.emit({
      severityNumber: SeverityNumber.ERROR,
      severityText: "ERROR",
      body: message,
      attributes: {
        ...(context ? { context } : {}),
        ...(trace ? { "exception.stacktrace": trace } : {}),
      },
    });
    console.error(`[${context ?? "App"}] ${message}`, trace ?? "");
  }

  warn(message: string, context?: string): void {
    this.logger.emit({
      severityNumber: SeverityNumber.WARN,
      severityText: "WARN",
      body: message,
      attributes: context ? { context } : undefined,
    });
    console.warn(`[${context ?? "App"}] ${message}`);
  }

  debug(message: string, context?: string): void {
    this.logger.emit({
      severityNumber: SeverityNumber.DEBUG,
      severityText: "DEBUG",
      body: message,
      attributes: context ? { context } : undefined,
    });
  }

  verbose(message: string, context?: string): void {
    this.logger.emit({
      severityNumber: SeverityNumber.TRACE,
      severityText: "TRACE",
      body: message,
      attributes: context ? { context } : undefined,
    });
  }

  setLogLevels(_levels: LogLevel[]): void {
    // OTel handles log levels at the collector/backend level
  }
}
```

**Step 2: Update index.ts**

```typescript
export { initOtel } from "./otel.js";
export { appMetrics } from "./metrics.js";
export { OtelLogger } from "./otel-logger.js";
```

**Step 3: Verify build**

Run: `cd apps/server/libs/observability && pnpm build`
Expected: Compiles with no errors.

**Step 4: Commit**

```bash
git add apps/server/libs/observability/src/
git commit -m "feat(observability): add OTel-backed NestJS LoggerService"
```

---

### Task 5: Integrate into Gateway service

**Files:**

- Create: `apps/server/apps/gateway/src/otel.ts`
- Modify: `apps/server/apps/gateway/src/main.ts`
- Modify: `apps/server/apps/gateway/package.json`

**Step 1: Add dependency to gateway package.json**

Add to `dependencies` in `apps/server/apps/gateway/package.json`:

```json
"@team9/observability": "workspace:*"
```

**Step 2: Create gateway otel.ts entry point**

Create `apps/server/apps/gateway/src/otel.ts`:

```typescript
import { initOtel } from "@team9/observability";

initOtel(process.env.OTEL_SERVICE_NAME || "gateway");
```

**Step 3: Modify main.ts to import otel.ts**

In `apps/server/apps/gateway/src/main.ts`, add the otel import right after `instrument.js`:

Change:

```typescript
import "./load-env.js"; // Load environment variables first
import "./instrument.js"; // Initialize Sentry before any other imports
```

To:

```typescript
import "./load-env.js"; // Load environment variables first
import "./instrument.js"; // Initialize Sentry before any other imports
import "./otel.js"; // Initialize OpenTelemetry
```

Then in the `bootstrap()` function, after `const app = await NestFactory.create(AppModule);`, add:

```typescript
// Use OTel logger when observability is enabled
if (process.env.OTEL_ENABLED === "true") {
  const { OtelLogger } = await import("@team9/observability");
  app.useLogger(new OtelLogger());
}
```

**Step 4: Install dependencies**

Run: `cd apps/server && pnpm install`

**Step 5: Verify build**

Run: `cd apps/server/apps/gateway && pnpm build`
Expected: Compiles with no errors.

**Step 6: Commit**

```bash
git add apps/server/apps/gateway/
git commit -m "feat(gateway): integrate OpenTelemetry observability"
```

---

### Task 6: Integrate into im-worker service

**Files:**

- Create: `apps/server/apps/im-worker/src/otel.ts`
- Modify: `apps/server/apps/im-worker/src/main.ts`
- Modify: `apps/server/apps/im-worker/package.json`

**Step 1: Add dependency to im-worker package.json**

Add to `dependencies` in `apps/server/apps/im-worker/package.json`:

```json
"@team9/observability": "workspace:*"
```

**Step 2: Create im-worker otel.ts entry point**

Create `apps/server/apps/im-worker/src/otel.ts`:

```typescript
import { initOtel } from "@team9/observability";

initOtel(process.env.OTEL_SERVICE_NAME || "im-worker");
```

**Step 3: Modify main.ts to import otel.ts**

In `apps/server/apps/im-worker/src/main.ts`, add the otel import right after `instrument.js`:

Change:

```typescript
import "./instrument.js"; // Initialize Sentry before any other imports
```

To:

```typescript
import "./instrument.js"; // Initialize Sentry before any other imports
import "./otel.js"; // Initialize OpenTelemetry
```

Then in the `bootstrap()` function, after `const app = await NestFactory.create(AppModule);`, add:

```typescript
// Use OTel logger when observability is enabled
if (process.env.OTEL_ENABLED === "true") {
  const { OtelLogger } = await import("@team9/observability");
  app.useLogger(new OtelLogger());
}
```

**Step 4: Install dependencies**

Run: `cd apps/server && pnpm install`

**Step 5: Verify build**

Run: `cd apps/server/apps/im-worker && pnpm build`
Expected: Compiles with no errors.

**Step 6: Commit**

```bash
git add apps/server/apps/im-worker/
git commit -m "feat(im-worker): integrate OpenTelemetry observability"
```

---

### Task 7: Add business metric instrumentation to WebSocket Gateway

**Files:**

- Modify: `apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts`

**Step 1: Add import at top of file**

Add near the top imports of `websocket.gateway.ts`:

```typescript
import { appMetrics } from "@team9/observability";
```

**Step 2: Instrument handleConnection**

In the `handleConnection` method, after the line `client.emit(WS_EVENTS.AUTH.AUTHENTICATED, { userId: payload.sub });` (near the end of the try block), add:

```typescript
appMetrics.wsConnections.add(1);
appMetrics.onlineUsers.add(1);
```

**Step 3: Instrument handleDisconnect**

In the `handleDisconnect` method, right after `if (socketClient.userId) {` (at the start of the userId block), add:

```typescript
appMetrics.wsConnections.add(-1);
```

And inside the `if (!hasActiveSessions)` block (for both bot and non-bot paths), before the `await this.usersService.setOffline(...)` call, add:

```typescript
appMetrics.onlineUsers.add(-1);
```

**Step 4: Instrument message broadcasting**

Search for all places where `WS_EVENTS.MESSAGE.NEW` is emitted in `websocket.gateway.ts`. Add after each emit:

```typescript
appMetrics.messagesTotal.add(1);
```

**Step 5: Verify build**

Run: `cd apps/server/apps/gateway && pnpm build`
Expected: Compiles with no errors.

**Step 6: Commit**

```bash
git add apps/server/apps/gateway/src/im/websocket/websocket.gateway.ts
git commit -m "feat(gateway): add WebSocket business metric instrumentation"
```

---

### Task 8: Reduce Sentry tracing sample rate

Now that OTel handles tracing, reduce Sentry's trace sampling to avoid duplicate overhead.

**Files:**

- Modify: `apps/server/apps/gateway/src/instrument.ts`
- Modify: `apps/server/apps/im-worker/src/instrument.ts`

**Step 1: Update gateway instrument.ts**

Change `tracesSampleRate` in `apps/server/apps/gateway/src/instrument.ts`:

```typescript
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 1.0,
```

**Step 2: Update im-worker instrument.ts**

Same change in `apps/server/apps/im-worker/src/instrument.ts`:

```typescript
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.05 : 1.0,
```

**Step 3: Commit**

```bash
git add apps/server/apps/gateway/src/instrument.ts apps/server/apps/im-worker/src/instrument.ts
git commit -m "perf(sentry): reduce trace sampling to 5% to avoid overlap with OTel"
```

---

### Task 9: Test locally with OTEL_ENABLED=false (default)

Verify the services start normally without OTel enabled.

**Step 1: Start gateway**

Run: `pnpm dev:server`
Expected: Gateway starts on port 3000 with no OTel-related output (since `OTEL_ENABLED` is not set).

**Step 2: Start im-worker**

Run: `pnpm dev:im-worker`
Expected: im-worker starts on port 3001 with no OTel-related output.

**Step 3: Hit health endpoint**

Run: `curl http://localhost:3000/api/health`
Expected: `{"status":"ok","timestamp":"..."}`

**Step 4: Commit (no changes expected, just verification)**

No commit needed — this is a verification step.

---

### Task 10: Update Docker configuration

Ensure the observability lib is included in Docker builds.

**Files:**

- Modify: `docker/gateway.Dockerfile` (if needed — check if libs/ is already copied)
- Modify: `docker/im-worker.Dockerfile` (if needed)

**Step 1: Check existing Dockerfiles**

Read `docker/gateway.Dockerfile` and `docker/im-worker.Dockerfile`. The `COPY` steps likely already copy all of `libs/` since they build the full server workspace. If `libs/observability/` would be excluded, add a COPY line.

**Step 2: Commit if changes were needed**

```bash
git add docker/
git commit -m "build(docker): include observability lib in Docker builds"
```

---

### Task 11: Document environment variables

**Files:**

- Modify: `apps/server/.env.example` (or create if doesn't exist)

**Step 1: Add OTel environment variables**

Add these lines to the env example file:

```bash
# OpenTelemetry / Grafana Cloud
OTEL_ENABLED=false
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-us-east-0.grafana.net/otlp
GRAFANA_CLOUD_TOKEN=
OTEL_SERVICE_NAME=gateway
```

**Step 2: Commit**

```bash
git add apps/server/.env.example
git commit -m "docs: add OpenTelemetry environment variables to .env.example"
```
