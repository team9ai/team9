import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { createOpenAI } from '@ai-sdk/openai';
import { Output, streamText } from 'ai';
import { z } from 'zod';
import {
  DATABASE_CONNECTION,
  and,
  asc,
  eq,
  inArray,
  isNull,
  sql,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { Inject } from '@nestjs/common';
import { ChannelsService } from '../im/channels/channels.service.js';
import { CommonStaffService } from '../applications/common-staff.service.js';
import { InstalledApplicationsService } from '../applications/installed-applications.service.js';
import { PersonalStaffService } from '../applications/personal-staff.service.js';
import { RoutinesService } from '../routines/routines.service.js';
import type {
  OnboardingChildAgentDraft,
  OnboardingGeneratedTask,
  WorkspaceOnboardingStepData,
} from '@team9/database/schemas';
import {
  buildGenerateAgentsPrompt,
  buildGenerateChannelsPrompt,
  buildGenerateTasksPrompt,
  normalizeOnboardingLanguage,
  onboardingMainAgentName,
  type OnboardingLanguage,
} from './onboarding.prompts.js';
import type {
  CompleteWorkspaceOnboardingDto,
  GenerateWorkspaceOnboardingDto,
  UpdateWorkspaceOnboardingDto,
} from './dto/index.js';

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

const DEFAULT_STAFF_MODEL = {
  provider: 'openrouter',
  id: 'anthropic/claude-sonnet-4.6',
} as const;

const ONBOARDING_CHANNEL_COUNT = 4;

const taskSchema = z.object({
  tasks: z.array(
    z.object({
      emoji: z.string(),
      title: z.string(),
    }),
  ),
});

const channelSchema = z.object({
  channels: z.array(
    z.object({
      name: z.string(),
    }),
  ),
});

const agentSchema = z.object({
  agents: z.object({
    main: z.object({
      description: z.string(),
    }),
    children: z.array(
      z.object({
        emoji: z.string(),
        name: z.string(),
      }),
    ),
  }),
});

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly channelsService: ChannelsService,
    private readonly installedApplicationsService: InstalledApplicationsService,
    private readonly personalStaffService: PersonalStaffService,
    private readonly commonStaffService: CommonStaffService,
    private readonly routinesService: RoutinesService,
  ) {}

  async createStarterRecord(workspaceId: string, userId: string) {
    return this.createRecord(workspaceId, userId, {
      status: 'in_progress',
      currentStep: 1,
      stepData: {},
    });
  }

  async createSkippedRecord(workspaceId: string, userId: string) {
    return this.createRecord(workspaceId, userId, {
      status: 'skipped',
      currentStep: 6,
      stepData: {},
      completedAt: new Date(),
    });
  }

  async listRoles(lang?: string, acceptLanguage?: string) {
    const resolvedLang = this.resolveLanguage(lang, acceptLanguage);
    const fallbackLang = resolvedLang === 'en' ? 'zh' : 'en';

    const roles = await this.db
      .select()
      .from(schema.onboardingRoles)
      .where(eq(schema.onboardingRoles.isActive, true))
      .orderBy(
        asc(schema.onboardingRoles.categoryKey),
        asc(schema.onboardingRoles.sortOrder),
      );

    return roles.map((role) => ({
      id: role.id,
      slug: role.slug,
      emoji: role.emoji,
      label:
        role.label[resolvedLang] ??
        role.label[fallbackLang] ??
        role.label.en ??
        role.slug,
      categoryKey: role.categoryKey,
      category:
        role.category[resolvedLang] ??
        role.category[fallbackLang] ??
        role.category.en ??
        role.categoryKey,
      featured: role.featured,
    }));
  }

  async getState(workspaceId: string, userId: string) {
    const existing = await this.findRecord(workspaceId, userId);
    if (existing) {
      return existing;
    }

    if (await this.shouldSelfHealMissingRecord(workspaceId, userId)) {
      return this.createStarterRecord(workspaceId, userId);
    }

    return null;
  }

  async updateState(
    workspaceId: string,
    userId: string,
    dto: UpdateWorkspaceOnboardingDto,
  ) {
    const record = await this.requireRecord(workspaceId, userId);
    if (record.status === 'provisioning') {
      throw new BadRequestException(
        'Onboarding is currently provisioning resources',
      );
    }
    if (record.status === 'provisioned') {
      return record;
    }

    const mergedStepData = dto.stepData
      ? this.mergeStepData(record.stepData, dto.stepData)
      : record.stepData;

    const [updated] = await this.db
      .update(schema.workspaceOnboarding)
      .set({
        currentStep: dto.currentStep ?? record.currentStep,
        status: dto.status ?? record.status,
        stepData: mergedStepData,
        version: sql`${schema.workspaceOnboarding.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.workspaceOnboarding.id, record.id))
      .returning();

    return updated;
  }

  async generateTasks(
    workspaceId: string,
    userId: string,
    dto: GenerateWorkspaceOnboardingDto,
  ) {
    await this.requireRecord(workspaceId, userId);

    const lang = normalizeOnboardingLanguage(dto.lang);
    const prompt = buildGenerateTasksPrompt({
      roleLabel: dto.role.selectedRoleLabel,
      roleSlug: dto.role.selectedRoleSlug,
      categoryKey: dto.role.selectedRoleCategoryKey,
      description: dto.role.description,
      lang,
    });

    const result = streamText({
      model: openrouter('anthropic/claude-sonnet-4-6'),
      output: Output.object({ schema: taskSchema }),
      prompt,
      temperature: 0.55,
      maxOutputTokens: 900,
    });

    const output = await this.resolveStructuredOutput(
      result.output,
      'Failed to generate task suggestions',
    );
    const tasks = output.tasks
      .slice(0, 3)
      .map<OnboardingGeneratedTask>((task) => ({
        id: uuidv7(),
        emoji: task.emoji.trim(),
        title: task.title.trim(),
      }));

    return { tasks };
  }

  async generateChannels(
    workspaceId: string,
    userId: string,
    dto: GenerateWorkspaceOnboardingDto,
  ) {
    await this.requireRecord(workspaceId, userId);

    const lang = normalizeOnboardingLanguage(dto.lang);
    const prompt = buildGenerateChannelsPrompt({
      roleLabel: dto.role.selectedRoleLabel,
      roleSlug: dto.role.selectedRoleSlug,
      categoryKey: dto.role.selectedRoleCategoryKey,
      description: dto.role.description,
      tasks: dto.tasks,
      lang,
    });

    const result = streamText({
      model: openrouter('anthropic/claude-sonnet-4-6'),
      output: Output.object({ schema: channelSchema }),
      prompt,
      temperature: 0.5,
      maxOutputTokens: 700,
    });

    const output = await this.resolveStructuredOutput(
      result.output,
      'Failed to generate channel drafts',
    );
    const seen = new Set<string>();
    const channelNames = output.channels
      .map((channel) => this.normalizeChannelDraftName(channel.name))
      .filter((name) => {
        if (!name || seen.has(name.toLowerCase())) {
          return false;
        }
        seen.add(name.toLowerCase());
        return true;
      });

    for (const fallbackName of this.buildFallbackChannelNames(dto)) {
      const normalizedName = this.normalizeChannelDraftName(fallbackName);
      if (!normalizedName || seen.has(normalizedName.toLowerCase())) {
        continue;
      }
      seen.add(normalizedName.toLowerCase());
      channelNames.push(normalizedName);
      if (channelNames.length >= ONBOARDING_CHANNEL_COUNT) {
        break;
      }
    }

    const channels = channelNames
      .slice(0, ONBOARDING_CHANNEL_COUNT)
      .map((name) => ({
        id: uuidv7(),
        name: `#${name}`,
      }));

    if (channels.length < ONBOARDING_CHANNEL_COUNT) {
      throw new BadRequestException(
        'Failed to generate enough usable channel drafts',
      );
    }

    return { channels };
  }

  async generateAgents(
    workspaceId: string,
    userId: string,
    dto: GenerateWorkspaceOnboardingDto,
  ) {
    await this.requireRecord(workspaceId, userId);

    const lang = normalizeOnboardingLanguage(dto.lang);
    const prompt = buildGenerateAgentsPrompt({
      roleLabel: dto.role.selectedRoleLabel,
      roleSlug: dto.role.selectedRoleSlug,
      categoryKey: dto.role.selectedRoleCategoryKey,
      description: dto.role.description,
      tasks: dto.tasks,
      lang,
    });

    const result = streamText({
      model: openrouter('anthropic/claude-sonnet-4-6'),
      output: Output.object({ schema: agentSchema }),
      prompt,
      temperature: 0.55,
      maxOutputTokens: 900,
    });

    const output = await this.resolveStructuredOutput(
      result.output,
      'Failed to generate agent lineup',
    );
    const children = output.agents.children
      .slice(0, 3)
      .map<OnboardingChildAgentDraft>((agent) => ({
        id: uuidv7(),
        emoji: agent.emoji.trim(),
        name: agent.name.trim(),
      }));

    if (children.length === 0) {
      throw new BadRequestException('Failed to generate usable child agents');
    }

    return {
      agents: {
        main: {
          emoji: '🧑‍💼',
          name: onboardingMainAgentName(lang),
          description: output.agents.main.description.trim(),
        },
        children,
      },
    };
  }

  async complete(
    workspaceId: string,
    userId: string,
    dto: CompleteWorkspaceOnboardingDto,
  ) {
    const record = await this.requireRecord(workspaceId, userId);

    if (record.status === 'skipped') {
      throw new BadRequestException('Skipped onboarding cannot be provisioned');
    }
    if (record.status === 'provisioned') {
      return record;
    }

    const lang = normalizeOnboardingLanguage(dto.lang);

    // Atomic state transition guards against concurrent complete() callers
    // (e.g. double-clicked "Finish" button). Only the request that flips the
    // row from completed|failed → provisioning gets a RETURNING row and
    // proceeds; losers re-read to emit a precise error.
    const [claimed] = await this.db
      .update(schema.workspaceOnboarding)
      .set({
        status: 'provisioning',
        version: sql`${schema.workspaceOnboarding.version} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.workspaceOnboarding.id, record.id),
          inArray(schema.workspaceOnboarding.status, ['completed', 'failed']),
        ),
      )
      .returning();

    if (!claimed) {
      // Re-read is non-transactional: the row can transition again between
      // the failed CAS and this SELECT. Map the observed status to a precise
      // error instead of a blanket "must be completed" rejection.
      const current = await this.findRecord(workspaceId, userId);
      if (current?.status === 'provisioning') {
        throw new BadRequestException(
          'Onboarding provisioning is already in progress',
        );
      }
      if (current?.status === 'provisioned') {
        return current;
      }
      if (current?.status === 'completed' || current?.status === 'failed') {
        // Tight race: winner finished (possibly with failure) and the row is
        // back in a claimable state. Signal the caller to retry rather than
        // claiming "must be completed", which would be misleading.
        throw new ConflictException(
          'Onboarding state changed during provisioning; please retry.',
        );
      }
      throw new BadRequestException(
        'Onboarding must be completed before provisioning',
      );
    }

    // Use the row returned by the CAS UPDATE as the authoritative snapshot,
    // not the pre-CAS `record` read — otherwise stepData mutations between
    // requireRecord and the CAS would provision on stale data.
    try {
      await this.provisionChannels(
        workspaceId,
        userId,
        claimed.stepData.channels,
      );
      await this.provisionPersonalStaff(
        workspaceId,
        userId,
        claimed.stepData.agents,
        lang,
      );
      await this.provisionCommonStaff(
        workspaceId,
        userId,
        claimed.stepData.agents,
      );
      try {
        await this.provisionRoutines(
          workspaceId,
          userId,
          claimed.id,
          claimed.stepData,
        );
      } catch (routineErr) {
        this.logger.warn(
          `provisionRoutines failed for workspace ${workspaceId}, continuing`,
          routineErr,
        );
      }
      await this.persistPreferences(workspaceId, claimed.stepData);

      const [updated] = await this.db
        .update(schema.workspaceOnboarding)
        .set({
          status: 'provisioned',
          version: sql`${schema.workspaceOnboarding.version} + 1`,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.workspaceOnboarding.id, claimed.id))
        .returning();

      return updated;
    } catch (error) {
      this.logger.error(
        `Failed to provision onboarding resources for workspace ${workspaceId}: ${this.getErrorMessage(error)}`,
      );

      const [failed] = await this.db
        .update(schema.workspaceOnboarding)
        .set({
          status: 'failed',
          version: sql`${schema.workspaceOnboarding.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(schema.workspaceOnboarding.id, claimed.id))
        .returning();

      return failed;
    }
  }

  private async createRecord(
    workspaceId: string,
    userId: string,
    values: Pick<
      typeof schema.workspaceOnboarding.$inferInsert,
      'status' | 'currentStep' | 'stepData' | 'completedAt'
    >,
  ) {
    // Race-safe insert: two concurrent callers (e.g. duplicate webhook, double
    // tab) both pass the check-then-insert guard and collide on the
    // (tenant_id, user_id) unique index. ON CONFLICT DO NOTHING lets the
    // duplicate become a no-op, and we re-SELECT to return the winning row.
    const [inserted] = await this.db
      .insert(schema.workspaceOnboarding)
      .values({
        id: uuidv7(),
        tenantId: workspaceId,
        userId,
        status: values.status,
        currentStep: values.currentStep,
        stepData: values.stepData,
        completedAt: values.completedAt ?? null,
        version: 1,
      })
      .onConflictDoNothing({
        target: [
          schema.workspaceOnboarding.tenantId,
          schema.workspaceOnboarding.userId,
        ],
      })
      .returning();

    if (inserted) {
      return inserted;
    }

    const existing = await this.findRecord(workspaceId, userId);
    if (!existing) {
      // Log identifiers server-side; keep the client-facing message generic so
      // Nest's default serializer does not echo tenant/user IDs back on a 500.
      this.logger.error(
        `Failed to create workspace onboarding after INSERT ON CONFLICT race: tenant=${workspaceId} user=${userId}`,
      );
      throw new InternalServerErrorException(
        'Failed to create workspace onboarding',
      );
    }
    return existing;
  }

  private async provisionChannels(
    workspaceId: string,
    userId: string,
    channels: WorkspaceOnboardingStepData['channels'],
  ) {
    const drafts = channels?.channelDrafts ?? [];

    for (const draft of drafts) {
      const normalizedName = this.normalizeChannelDraftName(draft.name);
      if (!normalizedName) continue;

      const existing = await this.channelsService.findByNameAndTenant(
        normalizedName,
        workspaceId,
      );
      if (existing) continue;

      await this.channelsService.create(
        {
          name: normalizedName,
          type: 'public',
          description: 'Created during onboarding',
        },
        userId,
        workspaceId,
      );
    }
  }

  private async provisionPersonalStaff(
    workspaceId: string,
    userId: string,
    agents: WorkspaceOnboardingStepData['agents'],
    lang: OnboardingLanguage,
  ) {
    const main = agents?.main;
    if (!main) return;

    let app = await this.installedApplicationsService.findByApplicationId(
      workspaceId,
      'personal-staff',
    );

    if (!app) {
      app = await this.installedApplicationsService.install(
        workspaceId,
        userId,
        {
          applicationId: 'personal-staff',
        },
      );
    }

    const existingBot = await this.personalStaffService.findPersonalStaffBot(
      userId,
      app.id,
    );

    if (existingBot) {
      await this.personalStaffService.updateStaff(app.id, workspaceId, userId, {
        displayName: main.name || onboardingMainAgentName(lang),
        persona: main.description,
        model: DEFAULT_STAFF_MODEL,
      });
      return;
    }

    await this.personalStaffService.createStaff(app.id, workspaceId, userId, {
      displayName: main.name || onboardingMainAgentName(lang),
      persona: main.description,
      model: DEFAULT_STAFF_MODEL,
      agenticBootstrap: true,
    });
  }

  private async provisionCommonStaff(
    workspaceId: string,
    userId: string,
    agents: WorkspaceOnboardingStepData['agents'],
  ) {
    const children = agents?.children ?? [];
    if (children.length === 0) return;

    let app = await this.installedApplicationsService.findByApplicationId(
      workspaceId,
      'common-staff',
    );

    if (!app) {
      app = await this.installedApplicationsService.install(
        workspaceId,
        userId,
        {
          applicationId: 'common-staff',
        },
      );
    }

    const existingBots = await this.db
      .select({
        extra: schema.bots.extra,
      })
      .from(schema.bots)
      .where(eq(schema.bots.installedApplicationId, app.id));

    const existingRoleTitles = new Set(
      existingBots
        .map((bot) => bot.extra?.commonStaff?.roleTitle?.trim().toLowerCase())
        .filter((title): title is string => Boolean(title)),
    );

    for (const child of children) {
      const normalizedRoleTitle = child.name.trim().toLowerCase();
      if (!normalizedRoleTitle || existingRoleTitles.has(normalizedRoleTitle)) {
        continue;
      }

      // Leave displayName unset so the agentic bootstrap flow asks the mentor
      // to name the agent during its intro DM. child.name is a role title
      // (e.g. "Lead Qualifier"), not a person name — see onboarding.prompts.ts.
      await this.commonStaffService.createStaff(app.id, workspaceId, userId, {
        roleTitle: child.name.trim(),
        mentorId: userId,
        model: DEFAULT_STAFF_MODEL,
        agenticBootstrap: true,
      });

      existingRoleTitles.add(normalizedRoleTitle);
    }
  }

  private async provisionRoutines(
    workspaceId: string,
    userId: string,
    onboardingRecordId: string,
    stepData: WorkspaceOnboardingStepData,
  ) {
    const selectedTasks =
      stepData.tasks?.generatedTasks?.filter((task) =>
        stepData.tasks?.selectedTaskIds?.includes(task.id),
      ) ?? [];
    const customTask = stepData.tasks?.customTask?.trim() ?? null;

    if (selectedTasks.length === 0 && !customTask) {
      return;
    }

    // Find the personal-staff installed app for this workspace
    const personalStaffApp =
      await this.installedApplicationsService.findByApplicationId(
        workspaceId,
        'personal-staff',
      );

    if (!personalStaffApp) {
      this.logger.warn(
        `provisionRoutines: no personal-staff app installed for workspace ${workspaceId}, skipping`,
      );
      return;
    }

    const personalBot = await this.personalStaffService.findPersonalStaffBot(
      userId,
      personalStaffApp.id,
    );

    if (!personalBot) {
      this.logger.warn(
        `provisionRoutines: no personal-staff bot found for user ${userId} in workspace ${workspaceId}, skipping`,
      );
      return;
    }

    // Create draft routines for each selected generated task
    for (const task of selectedTasks) {
      const sourceRef = `onboarding:${onboardingRecordId}:${task.id}`;

      // Idempotency check
      const existing = await this.db
        .select({ id: schema.routines.id })
        .from(schema.routines)
        .where(
          and(
            eq(schema.routines.tenantId, workspaceId),
            eq(schema.routines.sourceRef, sourceRef),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        continue;
      }

      await this.routinesService.create(
        { title: task.title, botId: personalBot.botId, status: 'draft' },
        userId,
        workspaceId,
        { sourceRef },
      );
    }

    // Create draft routine for the customTask if present
    if (customTask) {
      const customSourceRef = `onboarding:${onboardingRecordId}:custom`;

      const existing = await this.db
        .select({ id: schema.routines.id })
        .from(schema.routines)
        .where(
          and(
            eq(schema.routines.tenantId, workspaceId),
            eq(schema.routines.sourceRef, customSourceRef),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        await this.routinesService.create(
          { title: customTask, botId: personalBot.botId, status: 'draft' },
          userId,
          workspaceId,
          { sourceRef: customSourceRef },
        );
      }
    }
  }

  private async persistPreferences(
    workspaceId: string,
    stepData: WorkspaceOnboardingStepData,
  ) {
    const [workspace] = await this.db
      .select({
        settings: schema.tenants.settings,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, workspaceId))
      .limit(1);

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    const nextSettings = {
      ...(workspace.settings ?? {}),
      onboarding: {
        role: stepData.role ?? null,
        tasks: {
          selectedTaskIds: stepData.tasks?.selectedTaskIds ?? [],
          // selectedTaskTitles removed — draft routines are now the canonical
          // representation of user-selected onboarding tasks.
          customTask: stepData.tasks?.customTask ?? null,
        },
      },
    } as schema.TenantSettings;

    await this.db
      .update(schema.tenants)
      .set({
        settings: nextSettings,
        updatedAt: new Date(),
      })
      .where(eq(schema.tenants.id, workspaceId));
  }

  private async findRecord(workspaceId: string, userId: string) {
    const [record] = await this.db
      .select()
      .from(schema.workspaceOnboarding)
      .where(
        and(
          eq(schema.workspaceOnboarding.tenantId, workspaceId),
          eq(schema.workspaceOnboarding.userId, userId),
        ),
      )
      .limit(1);

    return record ?? null;
  }

  private async shouldSelfHealMissingRecord(
    workspaceId: string,
    userId: string,
  ): Promise<boolean> {
    const memberships = await this.db
      .select({
        tenantId: schema.tenantMembers.tenantId,
        role: schema.tenantMembers.role,
        joinedAt: schema.tenantMembers.joinedAt,
      })
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.userId, userId),
          isNull(schema.tenantMembers.leftAt),
        ),
      );

    const targetMembership = memberships.find(
      (membership) => membership.tenantId === workspaceId,
    );
    if (targetMembership?.role !== 'owner') {
      return false;
    }

    const earliestOwnedMembership = memberships
      .filter((membership) => membership.role === 'owner')
      .sort(
        (left, right) => left.joinedAt.getTime() - right.joinedAt.getTime(),
      )[0];

    return earliestOwnedMembership?.tenantId === workspaceId;
  }

  private async requireRecord(workspaceId: string, userId: string) {
    const record = await this.findRecord(workspaceId, userId);
    if (!record) {
      throw new NotFoundException('Workspace onboarding not found');
    }
    return record;
  }

  private resolveLanguage(lang?: string, acceptLanguage?: string) {
    if (lang) {
      return normalizeOnboardingLanguage(lang);
    }

    return normalizeOnboardingLanguage(acceptLanguage);
  }

  private mergeStepData(
    current: WorkspaceOnboardingStepData | null | undefined,
    next: WorkspaceOnboardingStepData,
  ): WorkspaceOnboardingStepData {
    return {
      ...current,
      ...next,
      role: {
        ...(current?.role ?? {}),
        ...(next.role ?? {}),
      },
      tasks: {
        ...(current?.tasks ?? {}),
        ...(next.tasks ?? {}),
      },
      channels: {
        ...(current?.channels ?? {}),
        ...(next.channels ?? {}),
      },
      agents: {
        ...(current?.agents ?? {}),
        ...(next.agents ?? {}),
      },
      invite: {
        ...(current?.invite ?? {}),
        ...(next.invite ?? {}),
      },
      plan: {
        ...(current?.plan ?? {}),
        ...(next.plan ?? {}),
      },
    };
  }

  private normalizeChannelDraftName(value: string) {
    return value.replace(/^#+/, '').trim();
  }

  private buildFallbackChannelNames(dto: GenerateWorkspaceOnboardingDto) {
    const generatedTasks =
      dto.tasks?.generatedTasks?.map((task) => task.title.trim()) ?? [];
    const selectedTaskTitles =
      dto.tasks?.generatedTasks
        ?.filter((task) => dto.tasks?.selectedTaskIds?.includes(task.id))
        .map((task) => task.title.trim()) ?? [];
    const customTask = dto.tasks?.customTask?.trim();
    const roleLabel = dto.role.selectedRoleLabel?.trim();
    const description = dto.role.description?.trim();

    return [
      ...selectedTaskTitles,
      ...(customTask ? [customTask] : []),
      ...generatedTasks,
      ...(roleLabel ? [roleLabel] : []),
      ...(description ? [description] : []),
    ];
  }

  private async resolveStructuredOutput<T>(
    outputPromise: PromiseLike<T>,
    message: string,
  ): Promise<T> {
    try {
      return await outputPromise;
    } catch (error) {
      this.logger.warn(`${message}: ${this.getErrorMessage(error)}`);
      throw new BadRequestException(message);
    }
  }

  private getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}
