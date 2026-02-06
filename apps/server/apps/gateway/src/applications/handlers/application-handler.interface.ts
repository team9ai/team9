import type {
  InstalledApplication,
  ApplicationConfig,
  ApplicationSecrets,
  ApplicationPermissions,
} from '@team9/database/schemas';

/**
 * Context passed to application handlers during installation.
 */
export interface InstallContext {
  /** The installed application record (already created) */
  installedApplication: InstalledApplication;

  /** Tenant/Workspace ID */
  tenantId: string;

  /** User ID who triggered the installation */
  installedBy: string;
}

/**
 * Result returned from application handler after installation.
 * Used to update the installed application record with handler-specific data.
 */
export interface InstallResult {
  /** Updated config (merged with existing) */
  config?: ApplicationConfig;

  /** Updated secrets (merged with existing) */
  secrets?: ApplicationSecrets;

  /** Updated permissions (merged with existing) */
  permissions?: ApplicationPermissions;

  /** Associated bot ID (if the handler created one) */
  botId?: string;
}

/**
 * Interface for application-specific logic handlers.
 *
 * Each application type (e.g., 'openclaw', 'github') can have its own handler
 * that implements installation/uninstallation logic.
 */
export interface ApplicationHandler {
  /**
   * The application ID this handler is responsible for.
   * Must match the `applicationId` field in the applications definition.
   */
  readonly applicationId: string;

  /**
   * Called after the installed application record is created.
   * Use this to perform application-specific setup (e.g., create bots, external services).
   *
   * @returns Updated config/secrets/permissions to be merged into the record
   */
  onInstall(context: InstallContext): Promise<InstallResult>;

  /**
   * Called before the installed application record is deleted.
   * Use this to clean up application-specific resources.
   */
  onUninstall?(app: InstalledApplication): Promise<void>;
}
