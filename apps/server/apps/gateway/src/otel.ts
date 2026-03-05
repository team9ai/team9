import { initOtel } from '@team9/observability';

initOtel(process.env.OTEL_SERVICE_NAME || 'gateway');
