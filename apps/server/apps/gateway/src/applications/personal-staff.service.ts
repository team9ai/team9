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
import type { BotExtra } from '@team9/database/schemas';
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

export type { StaffBotResult as PersonalStaffResult };

const PERSONAL_STAFF_APPLICATION_ID = 'personal-staff';
const HIVE_BLUEPRINT_ID = 'team9-personal-staff';
const PERSONAL_STAFF_ROLE_TITLE = 'Personal Assistant';
/**
 * Fixed job description for every personal staff bot. Not persisted to the
 * DB and not user-editable — the `UpdatePersonalStaffDto` deliberately does
 * not expose `jobDescription`, and the agent-side `UpdateStaffProfile` tool
 * rejects `role` modifications outright for `staffKind: "personal"`. The
 * constant value is what `getStaff` returns and what the persona/avatar
 * generators see as context, so wording matters: frame the assistant as
 * dedicated to one specific owner, not as a generic AI helper.
 */
const PERSONAL_STAFF_JOB_DESCRIPTION =
  'Dedicated personal assistant for your owner';

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
        try {
          // Read the owner's persisted locale/timezone preferences so the
          // agent can greet them in the right language and format times in
          // the right zone. Both columns are nullable; when unset the agent
          // falls back to English + no zone hint.
          const locale = await this.usersService.getLocalePreferences(ownerId);

          const sessionId = `team9/${tenantId}/${result.agentId}/dm/${ownerDmChannel.id}`;
          await this.clawHiveService.sendInput(
            sessionId,
            {
              type: 'team9:bootstrap.start',
              source: 'team9',
              timestamp: new Date().toISOString(),
              payload: {
                mentorId: ownerId,
                isMentorDm: true,
                channelId: ownerDmChannel.id,
                // Standard session context consumed by Team9Component.onEvent.
                // Without this, team9-staff-bootstrap cannot tell it is in the
                // mentor DM and UpdateStaffProfile stays disabled.
                team9Context: {
                  source: 'team9',
                  scopeType: 'dm',
                  scopeId: ownerDmChannel.id,
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
            `Triggered bootstrap session for personal staff agent ${result.agentId}`,
          );
        } catch (bootstrapError) {
          this.logger.warn(
            `Failed to trigger bootstrap session for personal staff agent ${result.agentId}, continuing`,
            bootstrapError,
          );
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
    };

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
