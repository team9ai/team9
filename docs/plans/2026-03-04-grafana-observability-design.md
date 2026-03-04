# Grafana Observability Integration Design

**Date:** 2026-03-04
**Status:** Approved
**Scope:** Gateway + im-worker services
**Approach:** OpenTelemetry unified SDK → Grafana Cloud (OTLP)

## Overview

Integrate full observability (Metrics, Logs, Traces) into the NestJS Gateway and im-worker services using OpenTelemetry SDK, pushing data via OTLP to Grafana Cloud.

## Architecture

### Shared Library

New `@team9/observability` library shared by both services:

```
apps/server/libs/observability/
├── src/
│   ├── index.ts
│   ├── otel.ts                  # OTel NodeSDK initialization
│   ├── metrics/
│   │   ├── index.ts
│   │   └── custom-metrics.ts    # Business metric definitions
│   └── logging/
│       ├── index.ts
│       └── otel-logger.ts       # NestJS LoggerService implementation
└── package.json
```

### SDK Initialization

A single `otel.ts` file initializes the OpenTelemetry NodeSDK before NestJS boots, similar to the existing `instrument.ts` pattern for Sentry. It configures:

- **Trace exporter:** OTLP/proto → Grafana Cloud Tempo
- **Metric reader:** Periodic (15s interval) OTLP/proto → Grafana Cloud Mimir
- **Log exporter:** OTLP/proto → Grafana Cloud Loki
- **Auto-instrumentations:** HTTP, Express, NestJS, Socket.io, PostgreSQL, ioredis

### Environment Variables

| Variable                      | Description                    | Example                                                |
| ----------------------------- | ------------------------------ | ------------------------------------------------------ |
| `OTEL_ENABLED`                | Enable OTel (default: `false`) | `true`                                                 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Grafana Cloud OTLP endpoint    | `https://otlp-gateway-prod-us-east-0.grafana.net/otlp` |
| `GRAFANA_CLOUD_TOKEN`         | Base64 `instanceId:apiKey`     | `MTIzNDU6Z2xjX...`                                     |
| `OTEL_SERVICE_NAME`           | Service identifier             | `gateway` / `im-worker`                                |

### Coexistence with Sentry

Sentry is retained for error tracking and alerting. OTel handles metrics/traces/logs visualization. Sentry's tracing sample rate should be reduced (e.g., 5% production) to avoid duplicate overhead.

## Auto-Instrumentation

Zero-code instrumentation via `@opentelemetry/auto-instrumentations-node`:

| Package                       | Data Captured                                       |
| ----------------------------- | --------------------------------------------------- |
| `instrumentation-http`        | HTTP request/response traces, latency, status codes |
| `instrumentation-express`     | Express route-level spans                           |
| `instrumentation-nestjs-core` | NestJS controller/handler spans                     |
| `instrumentation-socket.io`   | Socket.io event traces                              |
| `instrumentation-pg`          | PostgreSQL query traces, latency                    |
| `instrumentation-ioredis`     | Redis command traces                                |

## Custom Business Metrics

| Metric                    | Type            | Description                  | Instrumentation Point                                    |
| ------------------------- | --------------- | ---------------------------- | -------------------------------------------------------- |
| `ws.connections`          | UpDownCounter   | Active WebSocket connections | `websocket.gateway.ts` handleConnection/handleDisconnect |
| `im.messages.total`       | Counter         | Total messages processed     | `websocket.gateway.ts` new_message handler               |
| `im.messages.duration_ms` | Histogram       | Message processing latency   | im-worker message consumer                               |
| `users.online`            | UpDownCounter   | Currently online users       | WebSocket connect/disconnect                             |
| `mq.queue.depth`          | ObservableGauge | RabbitMQ queue depth         | im-worker periodic check                                 |

## Structured Logging

Replace NestJS default `ConsoleLogger` with `OtelLogger` that implements `LoggerService`:

- Emits logs via OTel LoggerProvider with structured attributes
- Each log automatically carries `traceId` and `spanId` for correlation
- Existing `Logger` calls in codebase require no changes
- Applied via `app.useLogger(new OtelLogger())` in `main.ts`

### Development Environment

When `OTEL_ENABLED=false` (default), OTel initialization is skipped entirely. The standard NestJS console logger is used. No Grafana Cloud connection is attempted.

## Data Correlation in Grafana

- **Trace → Logs:** Logs carry traceId/spanId; Grafana shows related logs when viewing a trace
- **Trace → Metrics:** Exemplars link metric data points to specific traces
- **Logs → Trace:** traceId in log records links back to trace detail view

## Dependencies

```
@opentelemetry/sdk-node
@opentelemetry/api
@opentelemetry/api-logs
@opentelemetry/exporter-trace-otlp-proto
@opentelemetry/exporter-metrics-otlp-proto
@opentelemetry/exporter-logs-otlp-proto
@opentelemetry/sdk-metrics
@opentelemetry/auto-instrumentations-node
@opentelemetry/instrumentation-nestjs-core
@opentelemetry/instrumentation-socket.io
```

## Deployment

- Add environment variables to Railway for both Gateway and im-worker services
- `OTEL_SERVICE_NAME` differs per service (`gateway` vs `im-worker`)
- No sidecar or additional infrastructure required — direct OTLP push to Grafana Cloud
