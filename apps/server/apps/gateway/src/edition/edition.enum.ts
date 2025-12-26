export enum Edition {
  COMMUNITY = 'community',
  ENTERPRISE = 'enterprise',
}

export enum FeatureFlag {
  // Core features (all editions)
  BASIC_AUTH = 'basic_auth',
  CHANNELS = 'channels',
  DIRECT_MESSAGES = 'direct_messages',
  FILE_UPLOAD = 'file_upload',
  WEBSOCKET = 'websocket',
  MENTIONS = 'mentions',
  REACTIONS = 'reactions',

  // Enterprise features
  MULTI_TENANT = 'multi_tenant',
  SSO_SAML = 'sso_saml',
  SSO_OIDC = 'sso_oidc',
  AUDIT_LOG = 'audit_log',
  DATA_RETENTION = 'data_retention',
  DATA_EXPORT = 'data_export',
  ADVANCED_ANALYTICS = 'advanced_analytics',
  CUSTOM_BRANDING = 'custom_branding',
  PRIORITY_SUPPORT = 'priority_support',
  UNLIMITED_USERS = 'unlimited_users',
  UNLIMITED_CHANNELS = 'unlimited_channels',
  UNLIMITED_STORAGE = 'unlimited_storage',
}

export interface EditionConfig {
  edition: Edition;
  name: string;
  maxUsers: number;
  maxChannels: number;
  maxStorageMB: number;
  features: FeatureFlag[];
}

export const EDITION_CONFIGS: Record<Edition, EditionConfig> = {
  [Edition.COMMUNITY]: {
    edition: Edition.COMMUNITY,
    name: 'Community Edition',
    maxUsers: 100,
    maxChannels: 50,
    maxStorageMB: 5120, // 5GB
    features: [
      FeatureFlag.BASIC_AUTH,
      FeatureFlag.CHANNELS,
      FeatureFlag.DIRECT_MESSAGES,
      FeatureFlag.FILE_UPLOAD,
      FeatureFlag.WEBSOCKET,
      FeatureFlag.MENTIONS,
      FeatureFlag.REACTIONS,
    ],
  },
  [Edition.ENTERPRISE]: {
    edition: Edition.ENTERPRISE,
    name: 'Enterprise Edition',
    maxUsers: Infinity,
    maxChannels: Infinity,
    maxStorageMB: Infinity,
    features: Object.values(FeatureFlag),
  },
};
