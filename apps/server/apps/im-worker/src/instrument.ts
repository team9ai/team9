import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const dsn = process.env.SENTRY_IM_WORKER_DSN || process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  environment: process.env.NODE_ENV || 'development',
  enabled: !!dsn,
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
  integrations: [nodeProfilingIntegration()],
  serverName: 'im-worker',
});
