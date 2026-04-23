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

    // Fresh-workspace case (humanMembers === 1, i.e. just the owner): the
    // onboarding wizard drives the final name/persona/locale choice, then
    // calls updateStaff and explicitly triggers bootstrap — so the bot
    // greets with the chosen identity in the user's language. Firing
    // bootstrap here would use the default English role title before the
    // wizard has run, which is jarring.
    //
    // Multi-member backfill case (humanMembers > 1): the app is being
    // installed into a workspace that already has members. This happens
    // in two flavours:
    //
    //   a) New autoInstall ships when the workspace already has humans —
    //      none of them will re-run the onboarding wizard (their onboarding
    //      is 'provisioned'), so bootstrap must fire from here or they
    //      never get a greeting at all.
    //   b) Manual reinstall after existing members grew past 1 — here the
    //      owner's wizard has already persisted a chosen name/persona, but
    //      those fields live on the PREVIOUS bot row which was deleted on
    //      uninstall. The new bot inherits the default English role title
    //      again, and none of the members will run the wizard a second
    //      time. Firing bootstrap so everyone gets a fresh greeting is
    //      the intended behaviour — the prior persona was tied to the old
    //      bot.
    //
    // Both sub-cases accept the "default English name + empty persona"
    // tradeoff as the least-bad option vs. silent bots.
    const shouldBootstrap = humanMembers.length > 1;

    this.logger.log(
      `Creating personal staff for ${humanMembers.length} existing members in tenant ${tenantId} (bootstrap=${shouldBootstrap})`,
    );

    for (const member of humanMembers) {
      try {
        await personalStaffService.createStaff(
          installedApplication.id,
          tenantId,
          member.userId,
          {
            model: DEFAULT_MODEL,
            agenticBootstrap: shouldBootstrap,
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
