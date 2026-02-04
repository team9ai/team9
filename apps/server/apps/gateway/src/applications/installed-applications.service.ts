import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
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

export interface InstallApplicationDto {
  applicationId: string;
  name: string;
  description?: string;
  iconUrl?: string;
  config?: ApplicationConfig;
  secrets?: ApplicationSecrets;
  permissions?: ApplicationPermissions;
}

export interface UpdateInstalledApplicationDto {
  name?: string;
  description?: string;
  iconUrl?: string;
  config?: ApplicationConfig;
  secrets?: ApplicationSecrets;
  permissions?: ApplicationPermissions;
  isActive?: boolean;
}

/**
 * Omit secrets when returning to frontend.
 */
export type SafeInstalledApplication = Omit<InstalledApplication, 'secrets'>;

@Injectable()
export class InstalledApplicationsService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly applicationsService: ApplicationsService,
  ) {}

  /**
   * Install an application for a tenant.
   */
  async install(
    tenantId: string,
    installedBy: string,
    dto: InstallApplicationDto,
  ): Promise<SafeInstalledApplication> {
    const id = uuidv7();
    const now = new Date();

    const newRecord: NewInstalledApplication = {
      id,
      applicationId: dto.applicationId,
      name: dto.name,
      description: dto.description,
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
   */
  async uninstall(id: string, tenantId: string): Promise<void> {
    const existing = await this.findById(id, tenantId);
    if (!existing) {
      throw new NotFoundException(`Installed application ${id} not found`);
    }

    // Check if application can be uninstalled
    const application = this.applicationsService.findById(
      existing.applicationId,
    );
    if (application && application.uninstallable === false) {
      throw new ForbiddenException(
        `Application ${application.name} cannot be uninstalled`,
      );
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
   * Remove secrets from the result.
   */
  private omitSecrets(app: InstalledApplication): SafeInstalledApplication {
    const { secrets: _, ...safe } = app;
    return safe;
  }
}
