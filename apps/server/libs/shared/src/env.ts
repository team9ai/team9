/**
 * Environment variable configuration
 * All required environment variables must be defined, no fallback values allowed
 */

function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getRequiredEnvAsInt(key: string): number {
  const value = getRequiredEnv(key);
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(
      `Environment variable ${key} must be a valid integer, got: ${value}`,
    );
  }
  return parsed;
}

function getRequiredPemKey(key: string): string {
  const value = getRequiredEnv(key);
  return value.replace(/\\n/g, '\n');
}

function getAppEnv(): string {
  return process.env.APP_ENV || process.env.NODE_ENV || 'development';
}

export const env = {
  // JWT (ES256 - ECDSA P-256)
  get JWT_PRIVATE_KEY() {
    return getRequiredPemKey('JWT_PRIVATE_KEY');
  },
  get JWT_PUBLIC_KEY() {
    return getRequiredPemKey('JWT_PUBLIC_KEY');
  },
  get JWT_REFRESH_PRIVATE_KEY() {
    return getRequiredPemKey('JWT_REFRESH_PRIVATE_KEY');
  },
  get JWT_REFRESH_PUBLIC_KEY() {
    return getRequiredPemKey('JWT_REFRESH_PUBLIC_KEY');
  },
  get JWT_EXPIRES_IN() {
    return process.env.JWT_EXPIRES_IN || '7d';
  },
  get JWT_REFRESH_EXPIRES_IN() {
    return process.env.JWT_REFRESH_EXPIRES_IN || '30d';
  },

  // Database
  get POSTGRES_USER() {
    return getRequiredEnv('POSTGRES_USER');
  },
  get POSTGRES_PASSWORD() {
    return process.env.POSTGRES_PASSWORD; // Optional - some local DBs don't require password
  },
  get DB_HOST() {
    return getRequiredEnv('DB_HOST');
  },
  get DB_PORT() {
    return getRequiredEnvAsInt('DB_PORT');
  },
  get POSTGRES_DB() {
    return getRequiredEnv('POSTGRES_DB');
  },

  // Redis
  get REDIS_HOST() {
    return getRequiredEnv('REDIS_HOST');
  },
  get REDIS_PORT() {
    return getRequiredEnvAsInt('REDIS_PORT');
  },
  get REDIS_PASSWORD() {
    return process.env.REDIS_PASSWORD; // Optional
  },

  // RabbitMQ
  get RABBITMQ_HOST() {
    return getRequiredEnv('RABBITMQ_HOST');
  },
  get RABBITMQ_PORT() {
    return getRequiredEnvAsInt('RABBITMQ_PORT');
  },
  get RABBITMQ_USER() {
    return getRequiredEnv('RABBITMQ_USER');
  },
  get RABBITMQ_PASSWORD() {
    return getRequiredEnv('RABBITMQ_PASSWORD');
  },
  get RABBITMQ_VHOST() {
    return getRequiredEnv('RABBITMQ_VHOST');
  },

  // S3/MinIO Storage
  get S3_ENDPOINT() {
    // return getRequiredEnv('S3_ENDPOINT');
    return process.env.S3_ENDPOINT || undefined;
  },
  get S3_REGION() {
    return getRequiredEnv('S3_REGION');
  },
  get S3_ACCESS_KEY() {
    return getRequiredEnv('S3_ACCESS_KEY');
  },
  get S3_SECRET_KEY() {
    return getRequiredEnv('S3_SECRET_ACCESS_KEY');
  },
  get S3_FORCE_PATH_STYLE() {
    return process.env.S3_FORCE_PATH_STYLE === 'true';
  },
  // S3 CORS origins (comma-separated), falls back to CORS_ORIGIN if not set
  get S3_CORS_ORIGINS() {
    return process.env.S3_CORS_ORIGINS || '';
  },
  // Public base URL for serving S3 files (e.g. CloudFront custom domain).
  // Falls back to S3_ENDPOINT for backward compatibility (MinIO local dev).
  get S3_PUBLIC_URL() {
    return process.env.S3_PUBLIC_URL || process.env.S3_ENDPOINT || undefined;
  },
  // Shared S3 bucket name (single bucket for all workspaces)
  get S3_BUCKET() {
    return process.env.S3_BUCKET || `t9-${getAppEnv()}`;
  },

  // CORS
  get CORS_ORIGIN() {
    return getRequiredEnv('CORS_ORIGIN');
  },

  // Application URL
  get APP_URL() {
    return getRequiredEnv('APP_URL');
  },

  // API URL (Team9 backend server base URL)
  get API_URL() {
    return getRequiredEnv('API_URL');
  },

  // Billing Hub (optional — when unset, BillingHubService operates in bypass mode)
  get BILLING_HUB_BASE_URL(): string | undefined {
    return process.env.BILLING_HUB_BASE_URL || undefined;
  },
  get BILLING_HUB_SERVICE_KEY(): string | undefined {
    return process.env.BILLING_HUB_SERVICE_KEY || undefined;
  },
  // Shared secret validating inbound webhooks from billing-hub
  // (e.g. payment_succeeded → PostHog). Leave unset to disable the endpoint.
  get BILLING_HUB_WEBHOOK_SECRET(): string | undefined {
    return process.env.BILLING_HUB_WEBHOOK_SECRET || undefined;
  },

  // Application Environment
  get APP_ENV() {
    return getAppEnv();
  },

  // System Bot Configuration (optional)
  // If configured, this bot account will be automatically added to all new workspaces
  get SYSTEM_BOT_EMAIL() {
    return process.env.SYSTEM_BOT_EMAIL;
  },
  get SYSTEM_BOT_USERNAME() {
    return process.env.SYSTEM_BOT_USERNAME;
  },
  get SYSTEM_BOT_PASSWORD() {
    return process.env.SYSTEM_BOT_PASSWORD;
  },
  get SYSTEM_BOT_DISPLAY_NAME() {
    return process.env.SYSTEM_BOT_DISPLAY_NAME || 'Moltbot';
  },
  get SYSTEM_BOT_ENABLED() {
    return process.env.SYSTEM_BOT_ENABLED === 'true';
  },

  // Internal Auth (required for bot-token validation endpoint)
  get INTERNAL_AUTH_VALIDATION_TOKEN() {
    return getRequiredEnv('INTERNAL_AUTH_VALIDATION_TOKEN');
  },

  // OpenClaw Hive (optional)
  get OPENCLAW_API_URL() {
    return process.env.OPENCLAW_API_URL; // e.g. http://localhost:3000
  },
  get OPENCLAW_AUTH_TOKEN() {
    return process.env.OPENCLAW_AUTH_TOKEN;
  },
  // Fallback OpenClaw instance URL for local dev (skips DB secrets lookup)
  get OPENCLAW_INSTANCE_URL() {
    return process.env.OPENCLAW_INSTANCE_URL ?? process.env.OPENCLAW_API_URL;
  },
  get OPENCLAW_GATEWAY_TOKEN() {
    return process.env.OPENCLAW_GATEWAY_TOKEN;
  },

  // Claw Hive Integration (optional)
  get CLAW_HIVE_API_URL() {
    return process.env.CLAW_HIVE_API_URL; // e.g. http://localhost:4100
  },
  get CLAW_HIVE_AUTH_TOKEN() {
    return process.env.CLAW_HIVE_AUTH_TOKEN;
  },
  get CAPABILITY_BASE_URL() {
    return (
      process.env.CAPABILITY_BASE_URL || 'https://gateway.capability.team9.ai'
    );
  },

  // File-Keeper Service (optional)
  get FILE_KEEPER_BASE_URL() {
    return process.env.FILE_KEEPER_BASE_URL;
  },
  get FILE_KEEPER_JWT_SECRET() {
    return process.env.FILE_KEEPER_JWT_SECRET;
  },

  // Folder9 Managed Folder Service (optional - required for Wiki feature)
  get FOLDER9_API_URL() {
    return process.env.FOLDER9_API_URL;
  },
  get FOLDER9_PSK() {
    return process.env.FOLDER9_PSK;
  },
  get FOLDER9_WEBHOOK_SECRET() {
    return process.env.FOLDER9_WEBHOOK_SECRET;
  },

  // Gateway internal URL (used by im-worker to call /internal/* endpoints)
  get GATEWAY_INTERNAL_URL(): string | undefined {
    return process.env.GATEWAY_INTERNAL_URL || undefined;
  },

  // ahand-hub (optional - ahand device feature is gated on these being set)
  get AHAND_HUB_URL(): string | undefined {
    return process.env.AHAND_HUB_URL || undefined;
  },
  get AHAND_HUB_SERVICE_TOKEN(): string | undefined {
    return process.env.AHAND_HUB_SERVICE_TOKEN || undefined;
  },
  // Shared secret the hub signs webhook bodies with. Required when
  // AHAND_HUB_URL is set; the hub webhook controller rejects unsigned
  // callbacks.
  get AHAND_HUB_WEBHOOK_SECRET(): string | undefined {
    return process.env.AHAND_HUB_WEBHOOK_SECRET || undefined;
  },

  // Google OAuth (optional - Google login disabled if not set)
  get GOOGLE_CLIENT_ID() {
    return process.env.GOOGLE_CLIENT_ID;
  },

  // Cloudflare Turnstile (optional in non-production; required in production)
  get CLOUDFLARE_TURNSTILE_SECRET_KEY(): string | undefined {
    return process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || undefined;
  },

  // Email (Resend)
  get RESEND_API_KEY() {
    return process.env.RESEND_API_KEY; // Optional - email disabled if not set
  },
  get EMAIL_FROM() {
    return process.env.EMAIL_FROM || 'Team9 <noreply@auth.team9.ai>';
  },

  // PostHog (optional)
  get POSTHOG_PROJECT_API_KEY() {
    return process.env.POSTHOG_PROJECT_API_KEY;
  },
  get POSTHOG_HOST() {
    return process.env.POSTHOG_HOST;
  },
  get POSTHOG_FEATURE_FLAGS_SECURE_API_KEY() {
    return process.env.POSTHOG_FEATURE_FLAGS_SECURE_API_KEY;
  },

  // Web Push VAPID (optional)
  get VAPID_PUBLIC_KEY() {
    return process.env.VAPID_PUBLIC_KEY;
  },
  get VAPID_PRIVATE_KEY() {
    return process.env.VAPID_PRIVATE_KEY;
  },
  get VAPID_SUBJECT() {
    return process.env.VAPID_SUBJECT || 'mailto:noreply@team9.ai';
  },

  // Development: Skip email verification (only works when APP_ENV=local)
  // When enabled, registration and login will return verification link directly instead of sending email
  get DEV_SKIP_EMAIL_VERIFICATION() {
    return (
      process.env.DEV_SKIP_EMAIL_VERIFICATION === 'true' &&
      getAppEnv() === 'local'
    );
  },

  // Auto-migrate and auto-seed (optional - defaults to false)
  // Lenient truthy parsing: 1/true/yes/on (case-insensitive)
  get AUTO_MIGRATE() {
    const value = process.env.AUTO_MIGRATE?.toLowerCase().trim();
    return ['1', 'true', 'yes', 'on', 'y', 't'].includes(value ?? '');
  },
  get AUTO_SEED() {
    const value = process.env.AUTO_SEED?.toLowerCase().trim();
    return ['1', 'true', 'yes', 'on', 'y', 't'].includes(value ?? '');
  },
};
