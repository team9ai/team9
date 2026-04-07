import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Inject,
  UseGuards,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  inArray,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { WorkspaceGuard } from '../workspace/guards/workspace.guard.js';
import {
  WorkspaceRoleGuard,
  WorkspaceRoles,
} from '../workspace/guards/workspace-role.guard.js';
import {
  InstalledApplicationsService,
  type InstallApplicationDto,
  type UpdateInstalledApplicationDto,
  type SafeInstalledApplication,
} from './installed-applications.service.js';
import { ApplicationsService } from './applications.service.js';
import {
  OpenclawService,
  type Instance as OpenclawInstance,
} from '../openclaw/openclaw.service.js';
import { FileKeeperService } from '../file-keeper/file-keeper.service.js';
import { BotService } from '../bot/bot.service.js';
import { ChannelsService } from '../im/channels/channels.service.js';
import { WebsocketGateway } from '../im/websocket/websocket.gateway.js';
import { RedisService } from '@team9/redis';
import { WS_EVENTS } from '../im/websocket/events/events.constants.js';
import { REDIS_KEYS } from '../im/shared/constants/redis-keys.js';
import { generateSlug, generateShortId } from '../common/utils/slug.util.js';
import { resolveAgentTypeByApplicationId } from '../common/utils/agent-type.util.js';

type InstalledApplicationBot = Awaited<
  ReturnType<BotService['getBotsByInstalledApplicationId']>
>[number];

@Controller({
  path: 'installed-applications',
  version: '1',
})
@UseGuards(AuthGuard, WorkspaceGuard)
export class InstalledApplicationsController {
  private readonly logger = new Logger(InstalledApplicationsController.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly installedApplicationsService: InstalledApplicationsService,
    private readonly applicationsService: ApplicationsService,
    private readonly openclawService: OpenclawService,
    private readonly fileKeeperService: FileKeeperService,
    private readonly botService: BotService,
    private readonly channelsService: ChannelsService,
    private readonly websocketGateway: WebsocketGateway,
    private readonly redisService: RedisService,
  ) {}

  private async getBotsOrEmpty(
    installedApplicationId: string,
  ): Promise<InstalledApplicationBot[]> {
    try {
      return await this.botService.getBotsByInstalledApplicationId(
        installedApplicationId,
      );
    } catch {
      return [];
    }
  }

  private async getOpenclawInstanceOrNull(
    instanceId: string,
  ): Promise<OpenclawInstance | null> {
    try {
      return await this.openclawService.getInstance(instanceId);
    } catch {
      return null;
    }
  }

  /**
   * Get all installed applications for the current tenant.
   * Requires: workspace member
   */
  @Get()
  async findAll(@CurrentTenantId() tenantId: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    return this.installedApplicationsService.findAllByTenant(tenantId);
  }

  /**
   * Get all installed applications with their bots and instance status.
   * Aggregates data to avoid waterfall requests from the frontend.
   * NOTE: Must be declared before @Get(':id') to avoid route shadowing.
   */
  @Get('with-bots')
  async findAllWithBots(@CurrentTenantId() tenantId: string) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    const apps =
      await this.installedApplicationsService.findAllByTenant(tenantId);

    const results = await Promise.all(
      apps.map(async (app) => {
        if (app.status !== 'active') {
          return { ...app, bots: [], instanceStatus: null };
        }

        if (app.applicationId === 'openclaw') {
          const agentType = resolveAgentTypeByApplicationId(app.applicationId);
          const instancesId = (app.config as { instancesId?: string })
            ?.instancesId;
          const [bots, instance] = await Promise.all([
            this.getBotsOrEmpty(app.id),
            instancesId
              ? this.getOpenclawInstanceOrNull(instancesId)
              : Promise.resolve(null),
          ]);

          return {
            ...app,
            bots: bots.map((bot) => ({
              botId: bot.botId,
              userId: bot.userId,
              agentType,
              agentId: bot.extra?.openclaw?.agentId ?? null,
              workspace: bot.extra?.openclaw?.workspace ?? null,
              username: bot.username,
              displayName: bot.displayName,
              isActive: bot.isActive,
              createdAt: bot.createdAt,
              mentorId: bot.mentorId,
              mentorDisplayName: bot.mentorDisplayName,
              mentorAvatarUrl: bot.mentorAvatarUrl,
            })),
            instanceStatus: instance
              ? {
                  instanceId: instance.id,
                  status: instance.status,
                  accessUrl: instance.access_url,
                  createdAt: instance.created_at,
                  lastHeartbeat: instance.last_heartbeat,
                }
              : null,
          };
        }

        if (app.applicationId === 'base-model-staff') {
          const agentType = resolveAgentTypeByApplicationId(app.applicationId);
          const bots = await this.getBotsOrEmpty(app.id);
          return {
            ...app,
            bots: bots.map((bot) => ({
              botId: bot.botId,
              userId: bot.userId,
              agentType,
              username: bot.username,
              displayName: bot.displayName,
              isActive: bot.isActive,
              createdAt: bot.createdAt,
              managedMeta: bot.managedMeta,
            })),
            instanceStatus: null,
          };
        }

        if (app.applicationId === 'personal-staff') {
          const bots = await this.getBotsOrEmpty(app.id);
          const botUserIds = bots.map((bot) => bot.userId);
          let avatarMap: Map<string, string | null> = new Map();
          if (botUserIds.length > 0) {
            const userRows = await this.db
              .select({
                id: schema.users.id,
                avatarUrl: schema.users.avatarUrl,
              })
              .from(schema.users)
              .where(inArray(schema.users.id, botUserIds));
            avatarMap = new Map(userRows.map((r) => [r.id, r.avatarUrl]));
          }
          return {
            ...app,
            bots: bots.map((bot) => ({
              botId: bot.botId,
              userId: bot.userId,
              username: bot.username,
              displayName: bot.displayName,
              avatarUrl: avatarMap.get(bot.userId) ?? null,
              ownerId: bot.ownerId,
              persona: bot.extra?.personalStaff?.persona ?? null,
              model: bot.extra?.personalStaff?.model ?? null,
              visibility: {
                allowMention:
                  bot.extra?.personalStaff?.visibility?.allowMention ?? false,
                allowDirectMessage:
                  bot.extra?.personalStaff?.visibility?.allowDirectMessage ??
                  false,
              },
              isActive: bot.isActive,
              createdAt: bot.createdAt,
              managedMeta: bot.managedMeta,
            })),
            instanceStatus: null,
          };
        }

        if (app.applicationId === 'common-staff') {
          const bots = await this.getBotsOrEmpty(app.id);
          // Fetch bot user avatar URLs via direct DB join
          const botUserIds = bots.map((bot) => bot.userId);
          let avatarMap: Map<string, string | null> = new Map();
          if (botUserIds.length > 0) {
            const userRows = await this.db
              .select({
                id: schema.users.id,
                avatarUrl: schema.users.avatarUrl,
              })
              .from(schema.users)
              .where(inArray(schema.users.id, botUserIds));
            avatarMap = new Map(userRows.map((r) => [r.id, r.avatarUrl]));
          }
          return {
            ...app,
            bots: bots.map((bot) => ({
              botId: bot.botId,
              userId: bot.userId,
              username: bot.username,
              displayName: bot.displayName,
              roleTitle: bot.extra?.commonStaff?.roleTitle ?? null,
              persona: bot.extra?.commonStaff?.persona ?? null,
              jobDescription: bot.extra?.commonStaff?.jobDescription ?? null,
              avatarUrl: avatarMap.get(bot.userId) ?? null,
              model: bot.extra?.commonStaff?.model ?? null,
              mentorId: bot.mentorId,
              mentorDisplayName: bot.mentorDisplayName,
              mentorAvatarUrl: bot.mentorAvatarUrl,
              isActive: bot.isActive,
              createdAt: bot.createdAt,
              managedMeta: bot.managedMeta,
            })),
            instanceStatus: null,
          };
        }

        return { ...app, bots: [], instanceStatus: null };
      }),
    );

    return results;
  }

  /**
   * Get an installed application by ID.
   * Requires: workspace member
   */
  @Get(':id')
  async findById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    const app = await this.installedApplicationsService.findById(id, tenantId);
    if (!app) {
      throw new NotFoundException(`Installed application ${id} not found`);
    }
    return app;
  }

  /**
   * Install an application.
   * Requires: workspace admin or owner
   */
  @Post()
  @UseGuards(WorkspaceRoleGuard)
  @WorkspaceRoles('admin', 'owner')
  async install(
    @Body() dto: InstallApplicationDto,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }

    // Validate application exists
    const application = this.applicationsService.findById(dto.applicationId);
    if (!application) {
      throw new NotFoundException(`Application ${dto.applicationId} not found`);
    }

    return this.installedApplicationsService.install(tenantId, userId, {
      ...dto,
      iconUrl: dto.iconUrl || application.iconUrl,
    });
  }

  /**
   * Update an installed application.
   * Requires: workspace admin or owner
   */
  @Patch(':id')
  @UseGuards(WorkspaceRoleGuard)
  @WorkspaceRoles('admin', 'owner')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInstalledApplicationDto,
    @CurrentTenantId() tenantId: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    return this.installedApplicationsService.update(id, tenantId, dto);
  }

  /**
   * Uninstall an application.
   * Requires: workspace admin or owner
   */
  @Delete(':id')
  @UseGuards(WorkspaceRoleGuard)
  @WorkspaceRoles('admin', 'owner')
  async uninstall(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    await this.installedApplicationsService.uninstall(id, tenantId);
    return { success: true };
  }

  // ── OpenClaw-specific endpoints ──────────────────────────────────

  /**
   * Get OpenClaw instance status.
   */
  @Get(':id/openclaw/status')
  async getOpenClawStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    const app = await this.getVerifiedApp(id, tenantId, 'openclaw');
    const instancesId = (app.config as { instancesId?: string })?.instancesId;
    if (!instancesId) {
      throw new NotFoundException(
        'No instance configured for this application',
      );
    }
    const instance = await this.openclawService.getInstance(instancesId);
    if (!instance) {
      throw new NotFoundException('OpenClaw instance not found');
    }
    return {
      instanceId: instance.id,
      status: instance.status,
      accessUrl: instance.access_url,
      createdAt: instance.created_at,
      lastHeartbeat: instance.last_heartbeat,
    };
  }

  /**
   * Get OpenClaw bots info.
   */
  @Get(':id/openclaw/bots')
  async getOpenClawBots(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    const app = await this.getVerifiedApp(id, tenantId, 'openclaw');
    const bots = await this.botService.getBotsByInstalledApplicationId(app.id);
    return bots.map((bot) => ({
      botId: bot.botId,
      userId: bot.userId,
      agentId: bot.extra?.openclaw?.agentId ?? null,
      workspace: bot.extra?.openclaw?.workspace ?? null,
      username: bot.username,
      displayName: bot.displayName,
      isActive: bot.isActive,
      createdAt: bot.createdAt,
      mentorId: bot.mentorId,
      mentorDisplayName: bot.mentorDisplayName,
      mentorAvatarUrl: bot.mentorAvatarUrl,
    }));
  }

  /**
   * Update OpenClaw bot display name.
   */
  @Patch(':id/openclaw/bots/:botId')
  async updateOpenClawBot(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('botId', ParseUUIDPipe) botId: string,
    @CurrentTenantId() tenantId: string,
    @Body() body: { displayName: string },
  ) {
    await this.getVerifiedApp(id, tenantId, 'openclaw');
    const bot = await this.botService.getBotById(botId);
    if (!bot) {
      throw new NotFoundException('Bot not found');
    }
    if (!body.displayName || typeof body.displayName !== 'string') {
      throw new BadRequestException('displayName is required');
    }
    await this.botService.updateBotDisplayName(
      bot.botId,
      body.displayName.trim(),
    );
    return { success: true };
  }

  /**
   * Update mentor for an OpenClaw bot.
   * Only the current mentor or workspace admin/owner can transfer.
   */
  @Patch(':id/openclaw/bots/:botId/mentor')
  async updateOpenClawBotMentor(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('botId', ParseUUIDPipe) botId: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
    @Body() body: { mentorId: string | null },
  ) {
    await this.getVerifiedApp(id, tenantId, 'openclaw');
    const bot = await this.botService.getBotById(botId);
    if (!bot) {
      throw new NotFoundException('Bot not found');
    }

    // Permission: current mentor OR workspace admin/owner
    const isAdmin = await this.isWorkspaceAdmin(userId, tenantId);
    if (bot.mentorId !== userId && !isAdmin) {
      throw new ForbiddenException(
        'Only the current mentor or workspace admin can transfer mentorship',
      );
    }

    await this.botService.updateBotMentor(bot.botId, body.mentorId ?? null);
    return { success: true };
  }

  /**
   * Start OpenClaw instance.
   * Requires: workspace admin or owner
   */
  @Post(':id/openclaw/start')
  @UseGuards(WorkspaceRoleGuard)
  @WorkspaceRoles('admin', 'owner')
  async startOpenClaw(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    const app = await this.getVerifiedApp(id, tenantId, 'openclaw');
    const instancesId = (app.config as { instancesId?: string })?.instancesId;
    if (!instancesId) {
      throw new NotFoundException(
        'No instance configured for this application',
      );
    }
    await this.openclawService.startInstance(instancesId);
    return { success: true };
  }

  /**
   * Stop OpenClaw instance.
   * Requires: workspace admin or owner
   */
  @Post(':id/openclaw/stop')
  @UseGuards(WorkspaceRoleGuard)
  @WorkspaceRoles('admin', 'owner')
  async stopOpenClaw(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    const app = await this.getVerifiedApp(id, tenantId, 'openclaw');
    const instancesId = (app.config as { instancesId?: string })?.instancesId;
    if (!instancesId) {
      throw new NotFoundException(
        'No instance configured for this application',
      );
    }
    await this.openclawService.stopInstance(instancesId);
    return { success: true };
  }

  /**
   * Restart OpenClaw instance (stop then start).
   * Requires: workspace admin or owner
   */
  @Post(':id/openclaw/restart')
  @UseGuards(WorkspaceRoleGuard)
  @WorkspaceRoles('admin', 'owner')
  async restartOpenClaw(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    const app = await this.getVerifiedApp(id, tenantId, 'openclaw');
    const instancesId = (app.config as { instancesId?: string })?.instancesId;
    if (!instancesId) {
      throw new NotFoundException(
        'No instance configured for this application',
      );
    }
    await this.openclawService.stopInstance(instancesId);
    await this.openclawService.startInstance(instancesId);
    return { success: true };
  }

  // ── OpenClaw Device Pairing ─────────────────────────────────────

  /**
   * List paired/pending devices for an OpenClaw instance.
   */
  @Get(':id/openclaw/devices')
  async getOpenClawDevices(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    const app = await this.getVerifiedApp(id, tenantId, 'openclaw');
    const instancesId = (app.config as { instancesId?: string })?.instancesId;
    if (!instancesId) {
      throw new NotFoundException(
        'No instance configured for this application',
      );
    }
    const devices = await this.openclawService.listDevices(instancesId);
    return { devices: devices ?? [] };
  }

  /**
   * Return the OpenClaw gateway WebSocket URL for the calling user's workspace.
   * Used by Tauri desktop client to auto-configure the local aHand daemon.
   *
   * Auth: any authenticated workspace member (controller-level AuthGuard + WorkspaceGuard).
   */
  @Get(':id/openclaw/gateway-info')
  async getOpenClawGatewayInfo(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    const app = await this.getVerifiedApp(id, tenantId, 'openclaw');
    const instancesId = (app.config as { instancesId?: string })?.instancesId;
    if (!instancesId) {
      throw new NotFoundException(
        'No instance configured for this application',
      );
    }

    const instance = await this.openclawService.getInstance(instancesId);
    if (!instance) {
      throw new ServiceUnavailableException(
        'OpenClaw instance not found or not running',
      );
    }

    const accessUrl = instance.access_url;
    if (!accessUrl) {
      throw new ServiceUnavailableException('Gateway URL not available yet');
    }

    // Convert HTTP(S) access_url to WS(S) gateway URL.
    // e.g. https://instance-id.openclaw.cloud → wss://instance-id.openclaw.cloud:18789
    const gatewayUrl =
      accessUrl
        .replace(/^https:\/\//, 'wss://')
        .replace(/^http:\/\//, 'ws://')
        .replace(/\/$/, '') + ':18789';

    return {
      instanceId: instancesId,
      gatewayUrl,
      gatewayPort: 18789,
    };
  }

  /**
   * Self-approve a pending device pairing for the calling user's own device.
   * Used by Tauri to auto-approve without requiring admin intervention.
   *
   * Security: verifies the requestId is a valid pending request before approving.
   * Any authenticated workspace member can call this, but only for pending requests
   * on their own workspace's OpenClaw instance.
   */
  @Post(':id/openclaw/devices/self-approve')
  async selfApproveOpenClawDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @Body('requestId') requestId: string,
  ) {
    const app = await this.getVerifiedApp(id, tenantId, 'openclaw');
    const instancesId = (app.config as { instancesId?: string })?.instancesId;
    if (!instancesId) throw new NotFoundException('No instance configured');

    // Verify the requestId exists and is actually in pending state.
    // This prevents approving already-approved/rejected requests or invalid IDs.
    const devices = await this.openclawService.listDevices(instancesId);
    const target = devices?.find(
      (d) => d.request_id === requestId && d.status === 'pending',
    );
    if (!target) {
      throw new NotFoundException(
        'No pending device pairing request found with this ID',
      );
    }

    await this.openclawService.approveDevice(instancesId, requestId);
    return { approved: true, requestId };
  }

  /**
   * Approve a device pairing request.
   * Requires: workspace admin or owner
   */
  @Post(':id/openclaw/devices/approve')
  @UseGuards(WorkspaceRoleGuard)
  @WorkspaceRoles('admin', 'owner')
  async approveOpenClawDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @Body() body: { requestId: string },
  ) {
    const app = await this.getVerifiedApp(id, tenantId, 'openclaw');
    const instancesId = (app.config as { instancesId?: string })?.instancesId;
    if (!instancesId) {
      throw new NotFoundException(
        'No instance configured for this application',
      );
    }
    if (!body.requestId || typeof body.requestId !== 'string') {
      throw new BadRequestException('requestId is required');
    }
    await this.openclawService.approveDevice(instancesId, body.requestId);
    return { success: true };
  }

  /**
   * Reject a device pairing request.
   * Requires: workspace admin or owner
   */
  @Post(':id/openclaw/devices/reject')
  @UseGuards(WorkspaceRoleGuard)
  @WorkspaceRoles('admin', 'owner')
  async rejectOpenClawDevice(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @Body() body: { requestId: string },
  ) {
    const app = await this.getVerifiedApp(id, tenantId, 'openclaw');
    const instancesId = (app.config as { instancesId?: string })?.instancesId;
    if (!instancesId) {
      throw new NotFoundException(
        'No instance configured for this application',
      );
    }
    if (!body.requestId || typeof body.requestId !== 'string') {
      throw new BadRequestException('requestId is required');
    }
    await this.openclawService.rejectDevice(instancesId, body.requestId);
    return { success: true };
  }

  /**
   * List workspaces for an OpenClaw instance via file-keeper.
   */
  @Get(':id/openclaw/workspaces')
  async getOpenClawWorkspaces(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    const app = await this.getVerifiedApp(id, tenantId, 'openclaw');
    const instancesId = (app.config as { instancesId?: string })?.instancesId;
    if (!instancesId) {
      throw new NotFoundException(
        'No instance configured for this application',
      );
    }
    const fkBaseUrl = await this.getFileKeeperBaseUrl(instancesId);
    const workspaces = await this.fileKeeperService.listWorkspaces(
      instancesId,
      fkBaseUrl,
    );
    return {
      instanceId: instancesId,
      workspaces: workspaces.map((w) => ({
        name: w.name,
        modified: w.modified,
      })),
    };
  }

  /**
   * Get a scoped file-keeper token for frontend direct access.
   * The frontend uses this token to call file-keeper APIs directly.
   */
  @Get(':id/openclaw/file-keeper-token')
  async getFileKeeperToken(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    const app = await this.getVerifiedApp(id, tenantId, 'openclaw');
    const instancesId = (app.config as { instancesId?: string })?.instancesId;
    if (!instancesId) {
      throw new NotFoundException(
        'No instance configured for this application',
      );
    }
    const fkBaseUrl = await this.getFileKeeperBaseUrl(instancesId);
    return this.fileKeeperService.issueToken(
      instancesId,
      ['workspace-dir', 'data-dir'],
      fkBaseUrl,
    );
  }

  // ── OpenClaw Agent CRUD ─────────────────────────────────────────

  /**
   * Check if a username is available (scoped to OpenClaw context).
   */
  @Get(':id/openclaw/check-username')
  async checkUsername(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentTenantId() tenantId: string,
    @Query('username') username: string,
  ) {
    await this.getVerifiedApp(id, tenantId, 'openclaw');
    if (!username || typeof username !== 'string') {
      throw new BadRequestException('username query parameter is required');
    }
    const taken = await this.botService.isUsernameTaken(username.trim());
    return { available: !taken };
  }

  /**
   * Create a new agent/bot in an OpenClaw instance.
   * Any workspace member can create. Creator becomes the mentor.
   */
  @Post(':id/openclaw/agents')
  async createOpenClawAgent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
    @Body()
    body: {
      displayName: string;
      username?: string;
      description?: string;
      agentSlug?: string;
    },
  ) {
    const app = await this.getVerifiedApp(id, tenantId, 'openclaw');
    const instancesId = (app.config as { instancesId?: string })?.instancesId;
    if (!instancesId) {
      throw new NotFoundException(
        'No instance configured for this application',
      );
    }

    if (!body.displayName || typeof body.displayName !== 'string') {
      throw new BadRequestException('displayName is required');
    }

    const displayName = body.displayName.trim();
    const username = body.username?.trim() || undefined;

    // Validate and check username uniqueness if provided
    if (username) {
      if (!/^[a-z0-9_]{3,100}$/.test(username)) {
        throw new BadRequestException(
          'Username must be 3-100 characters, lowercase letters, numbers, and underscores only',
        );
      }
      const taken = await this.botService.isUsernameTaken(username);
      if (taken) {
        throw new ConflictException('Username is already taken');
      }
    }

    // 0. Check instance is reachable before creating anything
    const t0 = Date.now();
    const instance = await this.openclawService.getInstance(instancesId);
    const t1 = Date.now();
    this.logger.log(
      `createOpenClawAgent: getInstance took ${t1 - t0}ms (instance=${instancesId}, status=${instance?.status})`,
    );
    if (!instance || instance.status !== 'running') {
      throw new ServiceUnavailableException(
        `OpenClaw instance is not running (status: ${instance?.status ?? 'not found'})`,
      );
    }

    // 1. Create Team9 bot (creator = mentor)
    const { bot, accessToken } = await this.botService.createWorkspaceBot({
      ownerId: userId,
      tenantId,
      displayName,
      username,
      installedApplicationId: app.id,
      generateToken: true,
      mentorId: userId,
    });
    const t2 = Date.now();
    this.logger.log(
      `createOpenClawAgent: createWorkspaceBot took ${t2 - t1}ms (botId=${bot.botId})`,
    );

    // 2. Create agent on OpenClaw control plane with dedicated workspace
    // Pass full absolute path so the daemon creates the workspace at the
    // location file-keeper expects: .openclaw/workspace-{name}/
    const workspaceName = bot.botId;
    // Use transliteration slug + random suffix as agent name so the CLI's
    // normalizeAgentId won't strip non-ASCII characters (Chinese, Japanese, etc.)
    // and the random suffix prevents collisions between similar names.
    // Frontend may pass a pre-computed slug for consistency with the UI preview.
    const slugBase = body.agentSlug?.trim() || generateSlug(displayName, 40);
    const agentSlug = `${slugBase}-${generateShortId(4)}`;
    let agent: Awaited<ReturnType<OpenclawService['createAgent']>>;
    try {
      agent = await this.openclawService.createAgent(instancesId, {
        name: agentSlug,
        workspace: `/data/.openclaw/workspace-${workspaceName}`,
        team9_token: accessToken!,
      });
      const t3 = Date.now();
      this.logger.log(
        `createOpenClawAgent: createAgent took ${t3 - t2}ms, total ${t3 - t0}ms (instance=${instancesId}, slug=${agentSlug})`,
      );
    } catch (error) {
      const t3 = Date.now();
      this.logger.error(
        `createOpenClawAgent: createAgent FAILED after ${t3 - t2}ms, total ${t3 - t0}ms (instance=${instancesId}, error=${error instanceof Error ? error.message : error})`,
      );
      // Rollback: delete the bot we just created
      await this.botService.deleteBotAndCleanup(bot.botId);

      // ServiceUnavailableException from OpenclawService (network/timeout) — re-throw as-is
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      if (error instanceof Error) {
        // Control-plane returned 400 (CLI error like "agent already exists")
        if (error.message.includes('responded 400')) {
          const reason = error.message.split('— ').pop() || error.message;
          throw new BadRequestException(reason.trim());
        }
      }
      throw new ServiceUnavailableException(
        'Failed to create agent on OpenClaw instance',
      );
    }

    // Daemon may return "agentId" (camelCase) or "agent_id" (snake_case)
    const agentId = agent?.agentId ?? agent?.agent_id;

    if (!agentId) {
      // Agent creation returned empty — rollback the bot
      this.logger.error(
        `createOpenClawAgent: no agentId in response. Raw response: ${JSON.stringify(agent)}`,
      );
      await this.botService.deleteBotAndCleanup(bot.botId);
      throw new ServiceUnavailableException(
        'Failed to create agent on OpenClaw instance (no agent_id returned)',
      );
    }

    // 3. Store agentId and workspace name (not path) in bot's extra field
    // Frontend uses the name to build file-keeper URLs via workspace-dir/{name}
    await this.botService.updateBotExtra(bot.botId, {
      openclaw: {
        agentId,
        workspace: workspaceName,
      },
    });

    // 4. Update description if provided
    if (body.description) {
      await this.db
        .update(schema.bots)
        .set({ description: body.description.trim(), updatedAt: new Date() })
        .where(eq(schema.bots.id, bot.botId));
    }

    // 5. Create DM channels between new bot and all workspace members
    try {
      const members = await this.db
        .select({ userId: schema.tenantMembers.userId })
        .from(schema.tenantMembers)
        .where(eq(schema.tenantMembers.tenantId, tenantId));

      const memberUserIds = members
        .map((m) => m.userId)
        .filter((uid) => uid !== bot.userId);

      if (memberUserIds.length > 0) {
        const dmChannels = await this.channelsService.createDirectChannelsBatch(
          bot.userId,
          memberUserIds,
          tenantId,
        );

        // Notify online users about new DM channels
        const onlineUsersHash = await this.redisService.hgetall(
          REDIS_KEYS.ONLINE_USERS,
        );

        await Promise.allSettled(
          Array.from(dmChannels.entries()).map(([otherUserId, dmChannel]) => {
            if (otherUserId in onlineUsersHash) {
              return this.websocketGateway.sendToUser(
                otherUserId,
                WS_EVENTS.CHANNEL.CREATED,
                dmChannel,
              );
            }
            return Promise.resolve();
          }),
        );
      }
    } catch (error) {
      // Don't fail agent creation if DM channel creation fails
      this.logger.warn(
        `Failed to create DM channels for new agent bot: ${error instanceof Error ? error.message : error}`,
      );
    }

    return {
      botId: bot.botId,
      agentId: agentId ?? null,
      displayName: bot.displayName,
      mentorId: userId,
    };
  }

  /**
   * Delete a non-default agent/bot from an OpenClaw instance.
   * Only the mentor or workspace admin/owner can delete.
   */
  @Delete(':id/openclaw/agents/:botId')
  async deleteOpenClawAgent(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('botId', ParseUUIDPipe) botId: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
  ) {
    const app = await this.getVerifiedApp(id, tenantId, 'openclaw');
    const bot = await this.botService.getBotById(botId);
    if (!bot) {
      throw new NotFoundException('Bot not found');
    }

    // Cannot delete the default bot
    const agentId = bot.extra?.openclaw?.agentId;
    if (!agentId) {
      throw new BadRequestException('Cannot delete the default bot');
    }

    // Permission: mentor, owner, or workspace admin/owner
    const isAdmin = await this.isWorkspaceAdmin(userId, tenantId);
    if (bot.mentorId !== userId && bot.ownerId !== userId && !isAdmin) {
      throw new ForbiddenException(
        'Only the mentor or workspace admin can delete this bot',
      );
    }

    // 1. Delete agent on control plane
    const instancesId = (app.config as { instancesId?: string })?.instancesId;
    if (instancesId) {
      try {
        await this.openclawService.deleteAgent(instancesId, agentId);
      } catch (error) {
        // Log but don't block cleanup if control plane fails
        console.warn(
          `Failed to delete agent ${agentId} on control plane:`,
          error,
        );
      }
    }

    // 2. Delete Team9 bot + shadow user
    await this.botService.deleteBotAndCleanup(botId);

    return { success: true };
  }

  // ── Helpers ──────────────────────────────────────────────────────

  /**
   * Check if user is workspace admin or owner.
   */
  private async isWorkspaceAdmin(
    userId: string,
    tenantId: string,
  ): Promise<boolean> {
    const [member] = await this.db
      .select({ role: schema.tenantMembers.role })
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.userId, userId),
          eq(schema.tenantMembers.tenantId, tenantId),
        ),
      )
      .limit(1);
    return member?.role === 'admin' || member?.role === 'owner';
  }

  private async getFileKeeperBaseUrl(
    instancesId: string,
  ): Promise<string | undefined> {
    const instance = await this.openclawService.getInstance(instancesId);
    if (instance?.file_keeper_domain) {
      return `https://${instance.file_keeper_domain}`;
    }
    return undefined; // falls back to FILE_KEEPER_BASE_URL in service
  }

  /**
   * Verify the installed app exists, belongs to the tenant, and matches the expected applicationId.
   */
  private async getVerifiedApp(
    id: string,
    tenantId: string,
    expectedApplicationId: string,
  ): Promise<SafeInstalledApplication> {
    if (!tenantId) {
      throw new BadRequestException('Tenant ID is required');
    }
    const app = await this.installedApplicationsService.findById(id, tenantId);
    if (!app) {
      throw new NotFoundException(`Installed application ${id} not found`);
    }
    if (app.applicationId !== expectedApplicationId) {
      throw new BadRequestException(
        `Application ${id} is not a ${expectedApplicationId} application`,
      );
    }
    return app;
  }
}
