import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Inject,
  UseGuards,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import {
  DATABASE_CONNECTION,
  eq,
  and,
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
import { OpenclawService } from '../openclaw/openclaw.service.js';
import { FileKeeperService } from '../file-keeper/file-keeper.service.js';
import { BotService } from '../bot/bot.service.js';

@Controller({
  path: 'installed-applications',
  version: '1',
})
@UseGuards(AuthGuard, WorkspaceGuard)
export class InstalledApplicationsController {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly installedApplicationsService: InstalledApplicationsService,
    private readonly applicationsService: ApplicationsService,
    private readonly openclawService: OpenclawService,
    private readonly fileKeeperService: FileKeeperService,
    private readonly botService: BotService,
  ) {}

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
   * Get an installed application by ID.
   * Requires: workspace member
   */
  @Get(':id')
  async findById(@Param('id') id: string, @CurrentTenantId() tenantId: string) {
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
    @Param('id') id: string,
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
    @Param('id') id: string,
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
    @Param('id') id: string,
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
    @Param('id') id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    const app = await this.getVerifiedApp(id, tenantId, 'openclaw');
    const bots = await this.botService.getBotsByInstalledApplicationId(app.id);
    return bots.map((bot) => ({
      botId: bot.botId,
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
    @Param('id') id: string,
    @Param('botId') botId: string,
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
    @Param('id') id: string,
    @Param('botId') botId: string,
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
    @Param('id') id: string,
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
    @Param('id') id: string,
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
    @Param('id') id: string,
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
    @Param('id') id: string,
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
   * Approve a device pairing request.
   * Requires: workspace admin or owner
   */
  @Post(':id/openclaw/devices/approve')
  @UseGuards(WorkspaceRoleGuard)
  @WorkspaceRoles('admin', 'owner')
  async approveOpenClawDevice(
    @Param('id') id: string,
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
    @Param('id') id: string,
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
    @Param('id') id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    const app = await this.getVerifiedApp(id, tenantId, 'openclaw');
    const instancesId = (app.config as { instancesId?: string })?.instancesId;
    if (!instancesId) {
      throw new NotFoundException(
        'No instance configured for this application',
      );
    }
    const workspaces = await this.fileKeeperService.listWorkspaces(instancesId);
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
    @Param('id') id: string,
    @CurrentTenantId() tenantId: string,
  ) {
    const app = await this.getVerifiedApp(id, tenantId, 'openclaw');
    const instancesId = (app.config as { instancesId?: string })?.instancesId;
    if (!instancesId) {
      throw new NotFoundException(
        'No instance configured for this application',
      );
    }
    return this.fileKeeperService.issueToken(instancesId, [
      'workspace-dir',
      'data-dir',
    ]);
  }

  // ── OpenClaw Agent CRUD ─────────────────────────────────────────

  /**
   * Create a new agent/bot in an OpenClaw instance.
   * Any workspace member can create. Creator becomes the mentor.
   */
  @Post(':id/openclaw/agents')
  async createOpenClawAgent(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @CurrentTenantId() tenantId: string,
    @Body() body: { displayName: string; description?: string },
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

    // 0. Check instance is reachable before creating anything
    const instance = await this.openclawService.getInstance(instancesId);
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
      installedApplicationId: app.id,
      generateToken: true,
      mentorId: userId,
    });

    // 2. Create agent on OpenClaw control plane with dedicated workspace
    // Pass full absolute path so the daemon creates the workspace at the
    // location file-keeper expects: .openclaw/workspace/{name}/
    const workspaceName = bot.botId;
    let agent: Awaited<ReturnType<OpenclawService['createAgent']>>;
    try {
      agent = await this.openclawService.createAgent(instancesId, {
        name: displayName,
        workspace: `/data/.openclaw/workspace/${workspaceName}`,
        team9_token: accessToken!,
      });
    } catch (error) {
      // Rollback: delete the bot we just created
      await this.botService.deleteBotAndCleanup(bot.botId);
      throw error;
    }

    // 3. Store agentId and workspace name (not path) in bot's extra field
    // Frontend uses the name to build file-keeper URLs via workspace-dir/{name}
    await this.botService.updateBotExtra(bot.botId, {
      openclaw: {
        agentId: agent?.agent_id,
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

    return {
      botId: bot.botId,
      agentId: agent?.agent_id ?? null,
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
    @Param('id') id: string,
    @Param('botId') botId: string,
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
