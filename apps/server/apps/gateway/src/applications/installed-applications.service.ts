import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type {
  InstalledApplication,
  NewInstalledApplication,
  ApplicationConfig,
  ApplicationSecrets,
  ApplicationPermissions,
} from '@team9/database/schemas';
import { ApplicationsService } from './applications.service.js';
import type { ApplicationHandler } from './handlers/application-handler.interface.js';

export interface InstallApplicationDto {
  applicationId: string;
  iconUrl?: string;
  config?: ApplicationConfig;
  secrets?: ApplicationSecrets;
  permissions?: ApplicationPermissions;
}

export interface UpdateInstalledApplicationDto {
  iconUrl?: string;
  config?: ApplicationConfig;
  secrets?: ApplicationSecrets;
  permissions?: ApplicationPermissions;
  isActive?: boolean;
}

/**
 * Omit secrets when returning to frontend.
 */
export type SafeInstalledApplication = Omit<InstalledApplication, 'secrets'> & {
  /** Application name from the application definition */
  name?: string;
  /** Application description from the application definition */
  description?: string;
  /** Application type from the application definition */
  type?: 'managed' | 'custom';
};

@Injectable()
export class InstalledApplicationsService {
  private readonly logger = new Logger(InstalledApplicationsService.name);
  private readonly handlers = new Map<string, ApplicationHandler>();

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly applicationsService: ApplicationsService,
    @Inject('APPLICATION_HANDLERS')
    handlers: ApplicationHandler[],
  ) {
    // Register handlers by applicationId
    for (const handler of handlers) {
      this.handlers.set(handler.applicationId, handler);
    }
  }

  /**
   * Install an application for a tenant.
   * Requires a registered handler for the applicationId.
   */
  async install(
    tenantId: string,
    installedBy: string,
    dto: InstallApplicationDto,
  ): Promise<SafeInstalledApplication> {
    // Fail fast if no handler registered
    const handler = this.handlers.get(dto.applicationId);
    if (!handler) {
      throw new NotFoundException(
        `No handler registered for application: ${dto.applicationId}`,
      );
    }

    // Check singleton constraint
    const appDefinition = this.applicationsService.findById(dto.applicationId);
    if (appDefinition?.singleton) {
      const [existing] = await this.db
        .select({ id: schema.installedApplications.id })
        .from(schema.installedApplications)
        .where(
          and(
            eq(schema.installedApplications.tenantId, tenantId),
            eq(schema.installedApplications.applicationId, dto.applicationId),
          ),
        )
        .limit(1);

      if (existing) {
        throw new ConflictException(
          `Application ${dto.applicationId} is already installed for this workspace`,
        );
      }
    }

    const id = uuidv7();
    const now = new Date();

    const newRecord: NewInstalledApplication = {
      id,
      applicationId: dto.applicationId,
      iconUrl: dto.iconUrl,
      tenantId,
      installedBy,
      config: dto.config ?? {},
      secrets: dto.secrets ?? {},
      permissions: dto.permissions ?? {},
      status: 'active',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };

    const [inserted] = await this.db
      .insert(schema.installedApplications)
      .values(newRecord)
      .returning();

    this.logger.log(`Invoking handler for application ${dto.applicationId}`);

    const result = await handler.onInstall({
      installedApplication: inserted,
      tenantId,
      installedBy,
    });

    // Update record with handler results
    if (result.config || result.secrets || result.permissions) {
      const [updated] = await this.db
        .update(schema.installedApplications)
        .set({
          config: { ...inserted.config, ...result.config },
          secrets: { ...inserted.secrets, ...result.secrets },
          permissions: { ...inserted.permissions, ...result.permissions },
          updatedAt: new Date(),
        })
        .where(eq(schema.installedApplications.id, id))
        .returning();

      return this.omitSecrets(updated);
    }

    return this.omitSecrets(inserted);
  }

  /**
   * Get all installed applications for a tenant.
   */
  async findAllByTenant(tenantId: string): Promise<SafeInstalledApplication[]> {
    const results = await this.db
      .select()
      .from(schema.installedApplications)
      .where(eq(schema.installedApplications.tenantId, tenantId));

    return results.map((r) => this.omitSecrets(r));
  }

  /**
   * Get an installed application by ID.
   */
  async findById(
    id: string,
    tenantId: string,
  ): Promise<SafeInstalledApplication | null> {
    const [result] = await this.db
      .select()
      .from(schema.installedApplications)
      .where(
        and(
          eq(schema.installedApplications.id, id),
          eq(schema.installedApplications.tenantId, tenantId),
        ),
      );

    return result ? this.omitSecrets(result) : null;
  }

  /**
   * Get an installed application with secrets (internal use only).
   */
  async findByIdWithSecrets(
    id: string,
    tenantId: string,
  ): Promise<InstalledApplication | null> {
    const [result] = await this.db
      .select()
      .from(schema.installedApplications)
      .where(
        and(
          eq(schema.installedApplications.id, id),
          eq(schema.installedApplications.tenantId, tenantId),
        ),
      );

    return result ?? null;
  }

  /**
   * Update an installed application.
   */
  async update(
    id: string,
    tenantId: string,
    dto: UpdateInstalledApplicationDto,
  ): Promise<SafeInstalledApplication> {
    const existing = await this.findById(id, tenantId);
    if (!existing) {
      throw new NotFoundException(`Installed application ${id} not found`);
    }

    // Check if this is a managed application - prevent user modifications
    const application = this.applicationsService.findById(
      existing.applicationId,
    );
    if (application?.type === 'managed' && dto.isActive !== undefined) {
      throw new ForbiddenException(
        `Managed application ${application.name} cannot be disabled`,
      );
    }

    const [updated] = await this.db
      .update(schema.installedApplications)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.installedApplications.id, id),
          eq(schema.installedApplications.tenantId, tenantId),
        ),
      )
      .returning();

    return this.omitSecrets(updated);
  }

  /**
   * Uninstall an application.
   * If a handler exists, it will be invoked to clean up application-specific resources.
   */
  async uninstall(id: string, tenantId: string): Promise<void> {
    const existing = await this.findByIdWithSecrets(id, tenantId);
    if (!existing) {
      throw new NotFoundException(`Installed application ${id} not found`);
    }

    // Check if this is a managed application - cannot be uninstalled
    const application = this.applicationsService.findById(
      existing.applicationId,
    );
    if (application?.type === 'managed') {
      throw new ForbiddenException(
        `Managed application ${application.name} cannot be uninstalled`,
      );
    }

    // Invoke handler cleanup if exists
    const handler = this.handlers.get(existing.applicationId);
    if (handler?.onUninstall) {
      this.logger.log(
        `Invoking uninstall handler for application ${existing.applicationId}`,
      );
      await handler.onUninstall(existing);
    }

    await this.db
      .delete(schema.installedApplications)
      .where(
        and(
          eq(schema.installedApplications.id, id),
          eq(schema.installedApplications.tenantId, tenantId),
        ),
      );
  }

  /**
   * Remove secrets and add application type from definition.
   */
  private omitSecrets(app: InstalledApplication): SafeInstalledApplication {
    const { secrets: _, ...safe } = app;
    const appDefinition = this.applicationsService.findById(app.applicationId);
    return {
      ...safe,
      name: appDefinition?.name,
      description: appDefinition?.description,
      type: appDefinition?.type,
    };
  }
}
