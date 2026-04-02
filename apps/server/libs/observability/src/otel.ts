import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions/incubating';

let sdk: NodeSDK | null = null;

export function initOtel(serviceName: string): void {
  const enabled = process.env.OTEL_ENABLED === 'true';
  if (!enabled) {
    return;
  }

  // Opt in to stable HTTP semantic conventions to get http.route in metrics
  process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'http';

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const token = process.env.GRAFANA_CLOUD_TOKEN;

  if (!endpoint || !token) {
    console.warn(
      '[OTel] OTEL_ENABLED=true but OTEL_EXPORTER_OTLP_ENDPOINT or GRAFANA_CLOUD_TOKEN is missing. Skipping.',
    );
    return;
  }

  const headers = { Authorization: `Basic ${token}` };
  const environment = process.env.NODE_ENV || 'development';

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
        '@opentelemetry/instrumentation-fs': { enabled: false },
        // Disable DNS to reduce noise
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();
  console.log(`[OTel] OpenTelemetry initialized for service: ${serviceName}`);

  // Graceful shutdown
  const shutdown = (): void => {
    if (!sdk) {
      return;
    }

    void sdk.shutdown().then(() => {
      console.log('[OTel] OpenTelemetry shut down');
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
