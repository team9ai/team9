import { isDeepStrictEqual } from 'node:util';
import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { BotExtra, ManagedMeta } from '@team9/database/schemas';
import { ClawHiveService } from '@team9/claw-hive';
import { ChannelsService } from '../im/channels/channels.service.js';
import { InstalledApplicationsService } from './installed-applications.service.js';
import { StaffService, type StaffBotResult } from './staff.service.js';
import { UsersService } from '../im/users/users.service.js';
import type {
  CreatePersonalStaffDto,
  UpdatePersonalStaffDto,
} from './dto/personal-staff.dto.js';
import type {
  GeneratePersonaDto,
  GenerateAvatarDto,
} from './dto/generate-persona.dto.js';
import {
  PERSONAL_STAFF_ROLE_TITLE,
  PERSONAL_STAFF_JOB_DESCRIPTION,
} from './personal-staff.constants.js';

export type { StaffBotResult as PersonalStaffResult };

const PERSONAL_STAFF_APPLICATION_ID = 'personal-staff';
const HIVE_BLUEPRINT_ID = 'team9-personal-staff';

@Injectable()
export class PersonalStaffService {
  private readonly logger = new Logger(PersonalStaffService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clawHiveService: ClawHiveService,
    private readonly channelsService: ChannelsService,
    private readonly installedApplicationsService: InstalledApplicationsService,
    private readonly staffService: StaffService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Find the personal staff bot for a given owner within an installed application.
   *
   * Returns the first bot where `ownerId` matches and `installedApplicationId` matches,
   * or null if no personal staff bot exists for this user.
   */
  async findPersonalStaffBot(
    ownerId: string,
    installedAppId: string,
  ): Promise<{
    botId: string;
    userId: string;
    displayName: string | null;
    avatarUrl: string | null;
    ownerId: string | null;
    mentorId: string | null;
    extra: BotExtra | null;
    managedMeta: ManagedMeta | null;
    isActive: boolean;
  } | null> {
    const rows = await this.db
      .select({
        botId: schema.bots.id,
        userId: schema.bots.userId,
        displayName: schema.users.displayName,
        avatarUrl: schema.users.avatarUrl,
        ownerId: schema.bots.ownerId,
        mentorId: schema.bots.mentorId,
        extra: schema.bots.extra,
        managedMeta: schema.bots.managedMeta,
        isActive: schema.bots.isActive,
      })
      .from(schema.bots)
      .innerJoin(schema.users, eq(schema.bots.userId, schema.users.id))
      .where(
        and(
          eq(schema.bots.ownerId, ownerId),
          eq(schema.bots.installedApplicationId, installedAppId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Verify the installed application is a personal-staff type.
   */
  private async verifyPersonalStaffApp(
    installedApplicationId: string,
    tenantId: string,
  ) {
    const app = await this.installedApplicationsService.findById(
      installedApplicationId,
      tenantId,
    );
    if (!app) {
      throw new NotFoundException(
        `Installed application ${installedApplicationId} not found`,
      );
    }
    if (app.applicationId !== PERSONAL_STAFF_APPLICATION_ID) {
      throw new BadRequestException(
        `Application ${installedApplicationId} is not a personal-staff application`,
      );
    }
    return app;
  }

  /**
   * Get the current user's personal staff bot.
   *
   * Returns the bot info with hardcoded roleTitle and jobDescription fields.
   */
  async getStaff(
    installedApplicationId: string,
    tenantId: string,
    ownerId: string,
  ) {
    await this.verifyPersonalStaffApp(installedApplicationId, tenantId);

    const bot = await this.findPersonalStaffBot(
      ownerId,
      installedApplicationId,
    );
    if (!bot) {
      throw new NotFoundException('Personal staff not found for current user');
    }

    const extra = (bot.extra as BotExtra) ?? {};
    return {
      botId: bot.botId,
      userId: bot.userId,
      displayName: bot.displayName,
      roleTitle: PERSONAL_STAFF_ROLE_TITLE,
      jobDescription: PERSONAL_STAFF_JOB_DESCRIPTION,
      persona: extra.personalStaff?.persona ?? null,
      model: extra.personalStaff?.model ?? null,
      visibility: extra.personalStaff?.visibility ?? {
        allowMention: false,
        allowDirectMessage: false,
      },
      avatarUrl: bot.avatarUrl,
    };
  }

  /**
   * Create a new personal-staff bot for the current user.
   *
   * Steps:
   * 1. Verify the installed application is personal-staff type
   * 2. Check uniqueness: one personal staff per user per workspace
   * 3. Create bot + register claw-hive agent via StaffService (mentorId = ownerId)
   * 4. Create owner↔bot DM channel
   * 5. If agenticBootstrap (default true), trigger bootstrap in the DM
   */
  async createStaff(
    installedApplicationId: string,
    tenantId: string,
    ownerId: string,
    dto: CreatePersonalStaffDto,
  ): Promise<StaffBotResult> {
    // 1. Verify app type
    await this.verifyPersonalStaffApp(installedApplicationId, tenantId);

    // 2. Uniqueness check
    const existing = await this.findPersonalStaffBot(
      ownerId,
      installedApplicationId,
    );
    if (existing) {
      throw new ConflictException(
        'A personal staff already exists for this user in this workspace',
      );
    }

    // 3. Create bot + register agent
    const effectiveDisplayName = dto.displayName ?? PERSONAL_STAFF_ROLE_TITLE;
    const effectiveBootstrap = dto.agenticBootstrap ?? true;

    const extra: BotExtra = {
      personalStaff: {
        persona: dto.persona,
        model: dto.model,
        visibility: {
          allowMention: false,
          allowDirectMessage: false,
        },
      },
    };

    let result: StaffBotResult;
    try {
      result = await this.staffService.createBotWithAgent({
        agentIdPrefix: 'personal-staff',
        blueprintId: HIVE_BLUEPRINT_ID,
        ownerId,
        tenantId,
        displayName: effectiveDisplayName,
        installedApplicationId,
        mentorId: ownerId, // Always the owner
        avatarUrl: dto.avatarUrl,
        model: dto.model,
        botExtra: extra,
        extraComponentConfigs: {
          'team9-staff-profile': {},
          'team9-staff-bootstrap': {},
          'team9-staff-soul': {},
        },
      });
    } catch (error: unknown) {
      // Catch DB unique constraint violation (race condition fallback)
      const isPersonalStaffUniqueViolation =
        error instanceof Error &&
        'code' in error &&
        (error as Record<string, unknown>).code === '23505' &&
        'constraint' in error &&
        (error as Record<string, unknown>).constraint ===
          'bots_owner_app_unique';
      if (isPersonalStaffUniqueViolation) {
        throw new ConflictException(
          'A personal staff already exists for this user in this workspace',
        );
      }
      throw error;
    }

    // 4. Create owner↔bot DM channel
    let dmChannelMap: Map<string, { id: string }> = new Map();
    try {
      dmChannelMap = await this.channelsService.createDirectChannelsBatch(
        result.userId,
        [ownerId],
        tenantId,
      );
      this.logger.log(
        `Created DM channel for personal staff bot ${result.botId} with owner ${ownerId}`,
      );
    } catch (dmError) {
      this.logger.warn(
        `Failed to create DM channel for personal staff bot ${result.botId}`,
        dmError,
      );
    }

    // 5. Trigger bootstrap session if enabled
    if (effectiveBootstrap) {
      const ownerDmChannel = dmChannelMap.get(ownerId);
      if (ownerDmChannel) {
        const sent = await this.sendBootstrapEvent({
          tenantId,
          agentId: result.agentId,
          ownerId,
          dmChannelId: ownerDmChannel.id,
        });
        // Stamp bootstrappedAt so any later idempotent caller (e.g. the
        // onboarding wizard's trigger path) does not re-fire the greeting.
        if (sent) {
          await this.markBootstrapped(result.botId, extra);
        }
      } else {
        this.logger.warn(
          `agenticBootstrap enabled but no DM channel found for owner ${ownerId} — skipping bootstrap`,
        );
      }
    }

    return {
      botId: result.botId,
      userId: result.userId,
      agentId: result.agentId,
      displayName: effectiveDisplayName,
    };
  }

  /**
   * Trigger the agentic bootstrap session for a personal-staff bot that
   * already exists. Intended for flows where `createStaff` was called with
   * `agenticBootstrap: false` (e.g. the workspace-creation auto-install
   * handler) and bootstrap should fire later — typically after the
   * onboarding wizard has persisted the final display name, persona, and
   * the user's browser-synced locale — so the agent's first greeting uses
   * the chosen identity and language instead of English defaults.
   *
   * Idempotency: gated on `bot.extra.personalStaff.bootstrappedAt`. If the
   * marker is already set, we short-circuit — this prevents
   * onboarding retries (triggered by a later failure in the provisioning
   * pipeline such as `provisionCommonStaff`) from re-firing the greeting
   * and producing a duplicate proactive message. The marker is persisted
   * *after* a successful send; if the send itself is retried it will fire
   * once more, which is acceptable as it covers the "first send was lost
   * in transit" recovery case.
   *
   * Fire-and-forget error handling: any failure is logged as a warning
   * and swallowed — this is never worth failing the caller over.
   */
  async triggerBootstrapForExistingStaff(
    installedApplicationId: string,
    tenantId: string,
    ownerId: string,
  ): Promise<void> {
    const bot = await this.findPersonalStaffBot(
      ownerId,
      installedApplicationId,
    );
    if (!bot) {
      this.logger.warn(
        `triggerBootstrapForExistingStaff: no personal staff bot for user ${ownerId} in app ${installedApplicationId}, skipping`,
      );
      return;
    }

    if (bot.extra?.personalStaff?.bootstrappedAt) {
      this.logger.log(
        `Skipping bootstrap for bot ${bot.botId} — already fired at ${bot.extra.personalStaff.bootstrappedAt}`,
      );
      return;
    }

    const agentId = bot.managedMeta?.agentId;
    if (!agentId) {
      this.logger.warn(
        `triggerBootstrapForExistingStaff: bot ${bot.botId} has no claw-hive agentId in managedMeta, skipping`,
      );
      return;
    }

    // Re-resolve (or lazily create) the owner↔bot DM channel. Under normal
    // flow the handler already created it during createStaff; calling
    // `createDirectChannel` again is idempotent and returns the existing
    // one.
    let dmChannel: { id: string };
    try {
      dmChannel = await this.channelsService.createDirectChannel(
        bot.userId,
        ownerId,
        tenantId,
      );
    } catch (dmError) {
      this.logger.warn(
        `triggerBootstrapForExistingStaff: failed to resolve DM channel for bot ${bot.botId} with owner ${ownerId}, skipping`,
        dmError,
      );
      return;
    }

    const sent = await this.sendBootstrapEvent({
      tenantId,
      agentId,
      ownerId,
      dmChannelId: dmChannel.id,
    });

    // Only persist the marker after a successful send so that a failed
    // first attempt retries on the next onboarding pass. Mark-write errors
    // are fire-and-forget: the worst case is one extra greeting on a
    // subsequent retry, which is better than silently dropping the marker
    // path and failing the whole onboarding.
    if (sent) {
      await this.markBootstrapped(bot.botId, bot.extra);
    }
  }

  private async markBootstrapped(
    botId: string,
    existingExtra: BotExtra | null,
  ): Promise<void> {
    try {
      const existing = existingExtra ?? {};
      const updatedExtra: BotExtra = {
        ...existing,
        personalStaff: {
          ...(existing.personalStaff ?? {}),
          bootstrappedAt: new Date().toISOString(),
        },
      };
      await this.db
        .update(schema.bots)
        .set({ extra: updatedExtra, updatedAt: new Date() })
        .where(eq(schema.bots.id, botId));
    } catch (markError) {
      this.logger.warn(
        `Failed to persist bootstrappedAt marker for bot ${botId}; duplicate greetings possible on onboarding retry`,
        markError,
      );
    }
  }

  /**
   * Emit the `team9:bootstrap.start` event to the claw-hive agent session
   * for a given personal-staff bot. Reads the owner's persisted locale
   * preferences so the agent's greeting is rendered in the right language
   * and time zone. Failures are logged as warnings and swallowed. Returns
   * `true` when the event was successfully dispatched, `false` otherwise —
   * callers use this to decide whether to persist an idempotency marker.
   */
  private async sendBootstrapEvent(params: {
    tenantId: string;
    agentId: string;
    ownerId: string;
    dmChannelId: string;
  }): Promise<boolean> {
    const { tenantId, agentId, ownerId, dmChannelId } = params;
    try {
      // Locale + timeZone columns are nullable. When unset the agent falls
      // back to English + no zone hint.
      const locale = await this.usersService.getLocalePreferences(ownerId);

      const sessionId = `team9/${tenantId}/${agentId}/dm/${dmChannelId}`;
      await this.clawHiveService.sendInput(
        sessionId,
        {
          type: 'team9:bootstrap.start',
          source: 'team9',
          timestamp: new Date().toISOString(),
          payload: {
            mentorId: ownerId,
            isMentorDm: true,
            channelId: dmChannelId,
            // Standard session context consumed by Team9Component.onEvent.
            // Without this, team9-staff-bootstrap cannot tell it is in the
            // mentor DM and UpdateStaffProfile stays disabled.
            team9Context: {
              source: 'team9',
              scopeType: 'dm',
              scopeId: dmChannelId,
              peerUserId: ownerId,
              isMentorDm: true,
              ...(locale.language ? { language: locale.language } : {}),
              ...(locale.timeZone ? { timeZone: locale.timeZone } : {}),
            },
          },
        },
        tenantId,
      );
      this.logger.log(
        `Triggered bootstrap session for personal staff agent ${agentId}`,
      );
      return true;
    } catch (bootstrapError) {
      this.logger.warn(
        `Failed to trigger bootstrap session for personal staff agent ${agentId}, continuing`,
        bootstrapError,
      );
      return false;
    }
  }

  /**
   * Update the current user's personal staff bot.
   *
   * Steps:
   * 1. Verify installed application is personal-staff type
   * 2. Find the user's personal staff bot
   * 3. Build merged BotExtra and delegate to StaffService
   */
  async updateStaff(
    installedApplicationId: string,
    tenantId: string,
    ownerId: string,
    dto: UpdatePersonalStaffDto,
  ) {
    // 1. Verify app type
    await this.verifyPersonalStaffApp(installedApplicationId, tenantId);

    // 2. Find personal staff bot
    const bot = await this.findPersonalStaffBot(
      ownerId,
      installedApplicationId,
    );
    if (!bot) {
      throw new NotFoundException('Personal staff not found for current user');
    }

    // 3. Build merged BotExtra
    const existingExtra = (bot.extra as BotExtra) ?? {};
    const existingPersonalStaff = existingExtra.personalStaff ?? {};
    const existingVisibility = existingPersonalStaff.visibility ?? {
      allowMention: false,
      allowDirectMessage: false,
    };

    // dm outbound policy: partial-update semantics — undefined means no change
    const currentPolicy = existingExtra.dmOutboundPolicy ?? null;
    const nextPolicy = dto.dmOutboundPolicy;
    let policyChanged = false;

    const updatedExtra: BotExtra = {
      ...existingExtra,
      personalStaff: {
        ...existingPersonalStaff,
        ...(dto.persona !== undefined ? { persona: dto.persona } : {}),
        ...(dto.model !== undefined ? { model: dto.model } : {}),
        ...(dto.visibility !== undefined
          ? {
              visibility: {
                ...existingVisibility,
                ...dto.visibility,
              },
            }
          : {}),
      },
      ...(nextPolicy !== undefined
        ? {
            dmOutboundPolicy: nextPolicy,
          }
        : {}),
    };

    if (nextPolicy !== undefined) {
      policyChanged = !isDeepStrictEqual(currentPolicy, nextPolicy);
    }

    await this.staffService.updateBotAndAgent({
      agentIdPrefix: 'personal-staff',
      botId: bot.botId,
      botUserId: bot.userId,
      tenantId,
      displayName: dto.displayName,
      avatarUrl: dto.avatarUrl,
      model: dto.model,
      botExtra: updatedExtra,
      currentMentorId: ownerId, // Mentor is always the owner
    });

    if (policyChanged) {
      this.logger.log({
        event: 'bot_dm_outbound_policy_changed',
        botId: bot.botId,
        botUserId: bot.userId,
        actorUserId: ownerId,
        from: currentPolicy,
        to: nextPolicy,
        timestamp: new Date().toISOString(),
      });
    }

    return this.getStaff(installedApplicationId, tenantId, ownerId);
  }

  /**
   * Delete the current user's personal staff bot.
   *
   * Steps:
   * 1. Verify installed application is personal-staff type
   * 2. Find the user's personal staff bot
   * 3. Delete bot + agent via StaffService
   */
  async deleteStaff(
    installedApplicationId: string,
    tenantId: string,
    ownerId: string,
  ): Promise<void> {
    // 1. Verify app type
    await this.verifyPersonalStaffApp(installedApplicationId, tenantId);

    // 2. Find personal staff bot
    const bot = await this.findPersonalStaffBot(
      ownerId,
      installedApplicationId,
    );
    if (!bot) {
      throw new NotFoundException('Personal staff not found for current user');
    }

    // 3. Delete bot + agent
    await this.staffService.deleteBotAndAgent({
      agentIdPrefix: 'personal-staff',
      botId: bot.botId,
    });
  }

  /**
   * Generate a personality-rich persona via streaming AI response.
   *
   * Delegates to StaffService.generatePersona after verifying the app type
   * and ownership.
   */
  async *generatePersona(
    appId: string,
    tenantId: string,
    ownerId: string,
    dto: GeneratePersonaDto,
  ): AsyncGenerator<string> {
    await this.verifyPersonalStaffApp(appId, tenantId);

    const bot = await this.findPersonalStaffBot(ownerId, appId);
    if (!bot) {
      throw new NotFoundException('Personal staff not found for current user');
    }

    yield* this.staffService.generatePersona({
      tenantId,
      installedApplicationId: appId,
      displayName: dto.displayName,
      roleTitle: PERSONAL_STAFF_ROLE_TITLE,
      existingPersona: dto.existingPersona,
      prompt: dto.prompt,
      jobDescription: PERSONAL_STAFF_JOB_DESCRIPTION,
    });
  }

  /**
   * Generate an avatar for a personal staff member.
   *
   * Delegates to StaffService.generateAvatar after verifying the app type
   * and ownership.
   */
  async generateAvatar(
    appId: string,
    tenantId: string,
    ownerId: string,
    dto: GenerateAvatarDto,
  ): Promise<{ avatarUrl: string }> {
    await this.verifyPersonalStaffApp(appId, tenantId);

    const bot = await this.findPersonalStaffBot(ownerId, appId);
    if (!bot) {
      throw new NotFoundException('Personal staff not found for current user');
    }

    return this.staffService.generateAvatar({
      style: dto.style,
      displayName: dto.displayName,
      roleTitle: PERSONAL_STAFF_ROLE_TITLE,
      persona: dto.persona,
      prompt: dto.prompt,
    });
  }
}
