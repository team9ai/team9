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
    return getRequiredEnv('POSTGRES_PASSWORD');
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
  // Shared S3 bucket name (single bucket for all workspaces)
  get S3_BUCKET() {
    return process.env.S3_BUCKET || `t9-${this.APP_ENV}`;
  },

  // CORS
  get CORS_ORIGIN() {
    return getRequiredEnv('CORS_ORIGIN');
  },

  // Application URL
  get APP_URL() {
    return getRequiredEnv('APP_URL');
  },

  // Application Environment
  get APP_ENV() {
    return process.env.APP_ENV || process.env.NODE_ENV || 'development';
  },

  // Task Tracker Service
  get TASK_TRACKER_PORT() {
    return parseInt(process.env.TASK_TRACKER_PORT || '3002', 10);
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

  // OpenClaw Hive (optional)
  get OPENCLAW_API_URL() {
    return process.env.OPENCLAW_API_URL; // e.g. http://localhost:3000
  },
  get OPENCLAW_AUTH_TOKEN() {
    return process.env.OPENCLAW_AUTH_TOKEN;
  },

  // Email (Resend)
  get RESEND_API_KEY() {
    return process.env.RESEND_API_KEY; // Optional - email disabled if not set
  },
  get EMAIL_FROM() {
    return process.env.EMAIL_FROM || 'Team9 <noreply@team9.app>';
  },
};
