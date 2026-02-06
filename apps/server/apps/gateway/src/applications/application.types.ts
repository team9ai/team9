/**
 * Application type - managed apps are controlled by the system and cannot be modified by users.
 */
export type ApplicationType = 'managed' | 'custom';

/**
 * Application definition - represents an available application that can be installed.
 */
export interface Application {
  /** Unique identifier for the application */
  id: string;

  /** Display name */
  name: string;

  /** Description of the application */
  description: string;

  /** Icon URL */
  iconUrl?: string;

  /** Application categories */
  categories: ApplicationCategory[];

  // TODO: Uncomment when implementing permissions
  // /** Default permissions for this application */
  // defaultPermissions: ApplicationDefaultPermissions;

  /** Whether the application is enabled */
  enabled: boolean;

  /** Application type - managed apps cannot be uninstalled or disabled by users */
  type: ApplicationType;

  /** If true, only one instance can be installed per tenant */
  singleton?: boolean;
}

export type ApplicationCategory =
  | 'ai'
  | 'bot'
  | 'productivity'
  | 'developer'
  | 'communication'
  | 'other';

// TODO: Uncomment when implementing permissions
// export interface ApplicationDefaultPermissions {
//   canReadMessages?: boolean;
//   canSendMessages?: boolean;
//   canManageChannels?: boolean;
//   canAccessFiles?: boolean;
//   scopes?: string[];
// }
