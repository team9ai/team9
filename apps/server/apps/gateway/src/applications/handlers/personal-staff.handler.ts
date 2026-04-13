import { Injectable, Inject, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  isNull,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { ConflictException } from '@nestjs/common';
import type {
  ApplicationHandler,
  InstallContext,
  InstallResult,
} from './application-handler.interface.js';
import type { PersonalStaffService } from '../personal-staff.service.js';

const DEFAULT_MODEL = {
  provider: 'openrouter' as const,
  id: 'anthropic/claude-sonnet-4.6',
};

@Injectable()
export class PersonalStaffHandler implements ApplicationHandler {
  readonly applicationId = 'personal-staff';
  private readonly logger = new Logger(PersonalStaffHandler.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly moduleRef: ModuleRef,
  ) {}

  /**
   * When the personal-staff app is installed (including via ensureAutoInstallApps),
   * create a personal staff bot for every existing human member of the workspace.
   *
   * Uses ModuleRef to lazily resolve PersonalStaffService, avoiding the circular
   * dependency: InstalledApplicationsService → handler → PersonalStaffService → InstalledApplicationsService.
   */
  async onInstall(context: InstallContext): Promise<InstallResult> {
    const { installedApplication, tenantId } = context;

    // Get all active human members of the workspace
    const members = await this.db
      .select({
        userId: schema.tenantMembers.userId,
        userType: schema.users.userType,
      })
      .from(schema.tenantMembers)
      .innerJoin(schema.users, eq(schema.tenantMembers.userId, schema.users.id))
      .where(
        and(
          eq(schema.tenantMembers.tenantId, tenantId),
          isNull(schema.tenantMembers.leftAt),
        ),
      );

    const humanMembers = members.filter(
      (m) => m.userType !== 'bot' && m.userType !== 'system',
    );

    if (humanMembers.length === 0) {
      this.logger.log(
        'No human members found — skipping personal staff creation',
      );
      return {};
    }

    // Lazily resolve PersonalStaffService to avoid circular constructor dependency
    const { PersonalStaffService: PSService } =
      await import('../personal-staff.service.js');
    const personalStaffService: PersonalStaffService = this.moduleRef.get(
      PSService,
      { strict: false },
    );

    this.logger.log(
      `Creating personal staff for ${humanMembers.length} existing members in tenant ${tenantId}`,
    );

    for (const member of humanMembers) {
      try {
        await personalStaffService.createStaff(
          installedApplication.id,
          tenantId,
          member.userId,
          {
            model: DEFAULT_MODEL,
            agenticBootstrap: false, // Don't trigger bootstrap for auto-install
          },
        );
        this.logger.log(`Created personal staff for user ${member.userId}`);
      } catch (error) {
        if (error instanceof ConflictException) {
          this.logger.log(
            `Skipped user ${member.userId} — already has personal staff`,
          );
        } else {
          this.logger.warn(
            `Failed to create personal staff for user ${member.userId}`,
            error,
          );
        }
      }
    }

    return {};
  }
}
