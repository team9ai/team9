import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ClawHiveService,
  type HivePrefabAgentTemplate,
} from '@team9/claw-hive';
import { DATABASE_CONNECTION, type PostgresJsDatabase } from '@team9/database';
import * as schema from '@team9/database/schemas';
import { RedisService } from '@team9/redis';
import { BotService } from '../bot/bot.service.js';
import { InstalledApplicationsService } from '../applications/installed-applications.service.js';
import { StaffService } from '../applications/staff.service.js';
import { ChannelsService } from '../im/channels/channels.service.js';
import {
  AGENT_HUB_RECOMMENDED_STAFF_CACHE_KEY,
  AGENT_HUB_RECOMMENDED_STAFF_CACHE_TTL_SECONDS,
  AGENT_HUB_RECOMMENDED_STAFF_FRESH_MS,
  DEFAULT_RECOMMENDED_STAFF_MODEL,
  type CachedRecommendedStaffTemplate,
  type RecommendedStaffCachePayload,
  type RecommendedStaffTemplate,
  type Team9PrefabStaffMetadata,
} from './agent-hub.types.js';

const COMMON_STAFF_APPLICATION_ID = 'common-staff';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toModel(value: unknown) {
  if (!isObject(value)) return null;

  const provider = stringOrNull(value.provider);
  const id = stringOrNull(value.id);
  if (!provider || !id) return null;

  return { provider, id };
}

function getTeam9Metadata(
  template: HivePrefabAgentTemplate,
): Team9PrefabStaffMetadata | null {
  const team9 = isObject(template.metadata)
    ? template.metadata.team9
    : undefined;
  if (!isObject(team9)) return null;

  const roleTitle = stringOrNull(team9.roleTitle);
  if (!roleTitle) return null;

  const metadata: Team9PrefabStaffMetadata = {
    roleTitle,
    unique: team9.unique === true,
  };

  const displayName = stringOrNull(team9.displayName);
  const shortRoleTitle = stringOrNull(team9.shortRoleTitle);
  const persona = stringOrNull(team9.persona);
  const jobDescription = stringOrNull(team9.jobDescription);
  const avatarUrl = stringOrNull(team9.avatarUrl);
  const model = toModel(team9.model);
  if (team9.model !== undefined && !model) return null;

  if (displayName) metadata.displayName = displayName;
  if (shortRoleTitle) metadata.shortRoleTitle = shortRoleTitle;
  if (persona) metadata.persona = persona;
  if (jobDescription) metadata.jobDescription = jobDescription;
  if (avatarUrl) metadata.avatarUrl = avatarUrl;
  if (model) metadata.model = model;

  return metadata;
}

function normalizeTemplate(
  template: HivePrefabAgentTemplate,
): CachedRecommendedStaffTemplate | null {
  const templateId = stringOrNull(template.id);
  const name = stringOrNull(template.name);
  const blueprintId = stringOrNull(template.blueprintId);
  if (!templateId || !name || !blueprintId) return null;

  const metadata = getTeam9Metadata(template);
  if (!metadata) return null;

  const model = metadata.model ?? toModel(template.model);
  if (template.model !== undefined && !metadata.model && !model) return null;
  const resolvedModel = model ?? DEFAULT_RECOMMENDED_STAFF_MODEL;

  const displayName = metadata.displayName ?? name;
  const componentConfigs = isObject(template.componentConfigs)
    ? template.componentConfigs
    : {};

  return {
    templateId,
    name,
    description: stringOrNull(template.description),
    displayName,
    roleTitle: metadata.roleTitle,
    shortRoleTitle: metadata.shortRoleTitle ?? null,
    persona: metadata.persona ?? null,
    jobDescription: metadata.jobDescription ?? null,
    avatarUrl: metadata.avatarUrl ?? null,
    model: resolvedModel,
    blueprintId,
    componentConfigs,
    unique: metadata.unique === true,
  };
}

@Injectable()
export class AgentHubService {
  private readonly logger = new Logger(AgentHubService.name);

  constructor(
    private readonly clawHive: ClawHiveService,
    private readonly redis: RedisService,
    private readonly installedApplications: InstalledApplicationsService,
    private readonly staffService: StaffService,
    private readonly bots: BotService,
    private readonly channels: ChannelsService,
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {
    void this.staffService;
    void this.channels;
    void this.db;
  }

  async listRecommendedStaff(
    tenantId: string,
  ): Promise<RecommendedStaffTemplate[]> {
    const templates = await this.getCachedTemplates();
    return this.withInstalledState(tenantId, templates);
  }

  private async getCachedTemplates(): Promise<
    CachedRecommendedStaffTemplate[]
  > {
    const cached = await this.readCache();
    if (cached && this.isFresh(cached)) {
      return cached.templates;
    }

    try {
      return await this.refreshTemplates();
    } catch (error) {
      if (cached) {
        this.logger.warn(
          'Failed to refresh AgentHub recommended staff catalog; using stale cache',
          error instanceof Error ? error.stack : undefined,
        );
        return cached.templates;
      }

      throw new ServiceUnavailableException(
        'AgentHub recommended staff is temporarily unavailable',
      );
    }
  }

  private async refreshTemplates(): Promise<CachedRecommendedStaffTemplate[]> {
    const templates = (await this.clawHive.listPrefabAgentTemplates())
      .map((template) => normalizeTemplate(template))
      .filter(
        (template): template is CachedRecommendedStaffTemplate =>
          template !== null,
      );

    try {
      await this.redis.set(
        AGENT_HUB_RECOMMENDED_STAFF_CACHE_KEY,
        JSON.stringify({
          cachedAt: new Date().toISOString(),
          templates,
        } satisfies RecommendedStaffCachePayload),
        AGENT_HUB_RECOMMENDED_STAFF_CACHE_TTL_SECONDS,
      );
    } catch (error) {
      this.logger.warn(
        'Failed to write AgentHub recommended staff catalog cache',
        error instanceof Error ? error.stack : undefined,
      );
    }

    return templates;
  }

  private async readCache(): Promise<RecommendedStaffCachePayload | null> {
    let cached: string | null;
    try {
      cached = await this.redis.get(AGENT_HUB_RECOMMENDED_STAFF_CACHE_KEY);
    } catch (error) {
      this.logger.warn(
        'Failed to read AgentHub recommended staff catalog cache',
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    }

    if (!cached) return null;

    try {
      const parsed = JSON.parse(cached) as unknown;
      if (!isObject(parsed)) return null;
      if (typeof parsed.cachedAt !== 'string') return null;
      if (Number.isNaN(Date.parse(parsed.cachedAt))) return null;
      if (!Array.isArray(parsed.templates)) return null;
      if (!parsed.templates.every(isCachedTemplate)) return null;

      return {
        cachedAt: parsed.cachedAt,
        templates: parsed.templates,
      };
    } catch {
      return null;
    }
  }

  private isFresh(payload: RecommendedStaffCachePayload): boolean {
    const cachedAt = Date.parse(payload.cachedAt);
    if (Number.isNaN(cachedAt)) return false;

    return Date.now() - cachedAt <= AGENT_HUB_RECOMMENDED_STAFF_FRESH_MS;
  }

  private async withInstalledState(
    tenantId: string,
    templates: CachedRecommendedStaffTemplate[],
  ): Promise<RecommendedStaffTemplate[]> {
    const installedByTemplateId = new Map<string, string>();
    const commonStaffApp = await this.installedApplications.findByApplicationId(
      tenantId,
      COMMON_STAFF_APPLICATION_ID,
    );

    if (commonStaffApp) {
      const bots = await this.bots.getBotsByInstalledApplicationId(
        commonStaffApp.id,
      );

      for (const bot of bots) {
        if (!bot.isActive) continue;

        const templateId = this.getBotPrefabTemplateId(bot);
        if (!templateId || installedByTemplateId.has(templateId)) continue;

        installedByTemplateId.set(templateId, bot.botId);
      }
    }

    return templates.map(({ blueprintId, componentConfigs, ...template }) => {
      void blueprintId;
      void componentConfigs;
      const installedBotId = installedByTemplateId.get(template.templateId);

      return {
        ...template,
        installed: Boolean(installedBotId),
        ...(installedBotId ? { installedBotId } : {}),
      };
    });
  }

  private getBotPrefabTemplateId(bot: {
    managedMeta: unknown;
    extra: unknown;
  }): string | null {
    if (isObject(bot.managedMeta)) {
      const templateId = stringOrNull(bot.managedMeta.prefabTemplateId);
      if (templateId) return templateId;
    }

    if (isObject(bot.extra) && isObject(bot.extra.commonStaff)) {
      return stringOrNull(bot.extra.commonStaff.prefabTemplateId);
    }

    return null;
  }
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isCachedTemplate(
  value: unknown,
): value is CachedRecommendedStaffTemplate {
  if (!isObject(value)) return false;

  return (
    typeof value.templateId === 'string' &&
    stringOrNull(value.templateId) !== null &&
    typeof value.name === 'string' &&
    stringOrNull(value.name) !== null &&
    isNullableString(value.description) &&
    typeof value.displayName === 'string' &&
    stringOrNull(value.displayName) !== null &&
    typeof value.roleTitle === 'string' &&
    stringOrNull(value.roleTitle) !== null &&
    isNullableString(value.shortRoleTitle) &&
    isNullableString(value.persona) &&
    isNullableString(value.jobDescription) &&
    isNullableString(value.avatarUrl) &&
    toModel(value.model) !== null &&
    typeof value.blueprintId === 'string' &&
    stringOrNull(value.blueprintId) !== null &&
    isObject(value.componentConfigs) &&
    typeof value.unique === 'boolean'
  );
}
