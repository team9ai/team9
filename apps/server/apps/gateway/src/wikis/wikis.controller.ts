import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { CurrentTenantId } from '../common/decorators/current-tenant.decorator.js';
import { WorkspaceGuard } from '../workspace/guards/workspace.guard.js';
import { BotService } from '../bot/bot.service.js';
import { WikisService, type ActingUser } from './wikis.service.js';
import { CreateWikiDto } from './dto/create-wiki.dto.js';
import { UpdateWikiDto } from './dto/update-wiki.dto.js';
import { CommitPageDto } from './dto/commit-page.dto.js';

/**
 * Optional body for a proposal rejection. `reason` is free-form prose stored
 * by folder9 on the proposal record.
 */
interface RejectProposalBody {
  reason?: string;
}

/**
 * Thin HTTP layer for the Wiki feature. Every endpoint:
 *   1. Resolves the acting workspace from the tenant-middleware-populated
 *      `request.tenantId` (team9 uses "tenant" and "workspace" interchangeably
 *      at the request level — the {@link WorkspaceGuard} also derives its
 *      membership check from the same field for `/api/wikis/*` routes which
 *      don't carry a `:workspaceId` path param).
 *   2. Builds an {@link ActingUser} by calling {@link BotService.isBot} so the
 *      service layer gets the (id, isAgent) tuple the permission model expects.
 *   3. Forwards the call to {@link WikisService} — no business logic lives here.
 *
 * The controller is keyed on `wikiId` (team9's authoritative Wiki primary key)
 * rather than folder9's `folderId`: not every folder9 folder is a Wiki, and
 * the `workspace_wikis` allow-list must be consulted first. The service
 * enforces that invariant; we just pass through.
 */
@Controller({ path: 'wikis', version: '1' })
@UseGuards(AuthGuard, WorkspaceGuard)
export class WikisController {
  private readonly logger = new Logger(WikisController.name);

  constructor(
    private readonly wikis: WikisService,
    private readonly bots: BotService,
  ) {}

  /**
   * Resolve the acting workspace id from the tenant middleware. We require it
   * here rather than delegating to the guard alone so a missing value surfaces
   * a clear 403 from the controller side instead of a downstream DB error.
   */
  private requireWorkspaceId(workspaceId: string | undefined): string {
    if (!workspaceId) {
      throw new ForbiddenException('Workspace context required');
    }
    return workspaceId;
  }

  /**
   * Guard `?path=` on page/raw lookups: if the client omits the query param
   * entirely, Nest hands us `undefined` and the folder9 call eventually
   * responds 400 with a less-friendly message. Validate here so the user gets
   * a clean 400 before any token-mint / downstream request is issued.
   */
  private requirePathQuery(path: string | undefined): string {
    if (!path || typeof path !== 'string' || path.trim().length === 0) {
      throw new BadRequestException('path query parameter is required');
    }
    return path;
  }

  /**
   * Look up the user type once per request and build the {@link ActingUser}
   * the service expects. Uses {@link BotService.isBot} — the canonical
   * `users.userType === 'bot'` check shared with the streaming controller.
   */
  private async actingUser(userId: string): Promise<ActingUser> {
    const isAgent = await this.bots.isBot(userId);
    return { id: userId, isAgent };
  }

  // ── Wiki CRUD ──────────────────────────────────────────────────────

  @Get()
  async list(@CurrentTenantId() workspaceId: string | undefined) {
    const ws = this.requireWorkspaceId(workspaceId);
    return this.wikis.listWikis(ws);
  }

  @Post()
  async create(
    @CurrentTenantId() workspaceId: string | undefined,
    @CurrentUser('sub') userId: string,
    @Body() dto: CreateWikiDto,
  ) {
    const ws = this.requireWorkspaceId(workspaceId);
    const user = await this.actingUser(userId);
    return this.wikis.createWiki(ws, user, dto);
  }

  @Get(':wikiId')
  async get(
    @CurrentTenantId() workspaceId: string | undefined,
    @CurrentUser('sub') userId: string,
    @Param('wikiId', ParseUUIDPipe) wikiId: string,
  ) {
    const ws = this.requireWorkspaceId(workspaceId);
    const user = await this.actingUser(userId);
    return this.wikis.getWiki(ws, wikiId, user);
  }

  @Patch(':wikiId')
  async update(
    @CurrentTenantId() workspaceId: string | undefined,
    @CurrentUser('sub') userId: string,
    @Param('wikiId', ParseUUIDPipe) wikiId: string,
    @Body() dto: UpdateWikiDto,
  ) {
    const ws = this.requireWorkspaceId(workspaceId);
    const user = await this.actingUser(userId);
    return this.wikis.updateWikiSettings(ws, wikiId, user, dto);
  }

  @Delete(':wikiId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(
    @CurrentTenantId() workspaceId: string | undefined,
    @CurrentUser('sub') userId: string,
    @Param('wikiId', ParseUUIDPipe) wikiId: string,
  ): Promise<void> {
    const ws = this.requireWorkspaceId(workspaceId);
    const user = await this.actingUser(userId);
    await this.wikis.archiveWiki(ws, wikiId, user);
  }

  // ── Content (tree / pages / raw / commit) ──────────────────────────

  @Get(':wikiId/tree')
  async getTree(
    @CurrentTenantId() workspaceId: string | undefined,
    @CurrentUser('sub') userId: string,
    @Param('wikiId', ParseUUIDPipe) wikiId: string,
    @Query('path') path?: string,
    @Query('recursive') recursive?: string,
  ) {
    const ws = this.requireWorkspaceId(workspaceId);
    const user = await this.actingUser(userId);
    return this.wikis.getTree(ws, wikiId, user, {
      path,
      recursive: recursive === 'true',
    });
  }

  @Get(':wikiId/pages')
  async getPage(
    @CurrentTenantId() workspaceId: string | undefined,
    @CurrentUser('sub') userId: string,
    @Param('wikiId', ParseUUIDPipe) wikiId: string,
    @Query('path') path?: string,
  ) {
    const ws = this.requireWorkspaceId(workspaceId);
    const safePath = this.requirePathQuery(path);
    const user = await this.actingUser(userId);
    return this.wikis.getPage(ws, wikiId, user, safePath);
  }

  /**
   * Stream raw file bytes (binary-safe). Used for cover images and other
   * binary assets where base64 round-tripping through `/pages` would be
   * wasteful. The response is a `StreamableFile` — NestJS pipes the buffer
   * straight into the HTTP response without JSON encoding.
   */
  @Get(':wikiId/raw')
  async getRaw(
    @CurrentTenantId() workspaceId: string | undefined,
    @CurrentUser('sub') userId: string,
    @Param('wikiId', ParseUUIDPipe) wikiId: string,
    @Query('path') path?: string,
  ): Promise<StreamableFile> {
    const ws = this.requireWorkspaceId(workspaceId);
    const safePath = this.requirePathQuery(path);
    const user = await this.actingUser(userId);
    const bytes = await this.wikis.getRaw(ws, wikiId, user, safePath);
    return new StreamableFile(Buffer.from(bytes));
  }

  @Post(':wikiId/commit')
  async commit(
    @CurrentTenantId() workspaceId: string | undefined,
    @CurrentUser('sub') userId: string,
    @Param('wikiId', ParseUUIDPipe) wikiId: string,
    @Body() dto: CommitPageDto,
  ) {
    const ws = this.requireWorkspaceId(workspaceId);
    const user = await this.actingUser(userId);
    return this.wikis.commitPage(ws, wikiId, user, dto);
  }

  // ── Proposals ──────────────────────────────────────────────────────

  @Get(':wikiId/proposals')
  async listProposals(
    @CurrentTenantId() workspaceId: string | undefined,
    @CurrentUser('sub') userId: string,
    @Param('wikiId', ParseUUIDPipe) wikiId: string,
    @Query('status') status?: string,
  ) {
    const ws = this.requireWorkspaceId(workspaceId);
    const user = await this.actingUser(userId);
    return this.wikis.listProposals(ws, wikiId, user, { status });
  }

  @Post(':wikiId/proposals/:proposalId/approve')
  @HttpCode(HttpStatus.NO_CONTENT)
  async approve(
    @CurrentTenantId() workspaceId: string | undefined,
    @CurrentUser('sub') userId: string,
    @Param('wikiId', ParseUUIDPipe) wikiId: string,
    @Param('proposalId') proposalId: string,
  ): Promise<void> {
    const ws = this.requireWorkspaceId(workspaceId);
    const user = await this.actingUser(userId);
    await this.wikis.approveProposal(ws, wikiId, user, proposalId);
  }

  @Post(':wikiId/proposals/:proposalId/reject')
  async reject(
    @CurrentTenantId() workspaceId: string | undefined,
    @CurrentUser('sub') userId: string,
    @Param('wikiId', ParseUUIDPipe) wikiId: string,
    @Param('proposalId') proposalId: string,
    @Body() body: RejectProposalBody = {},
  ): Promise<void> {
    const ws = this.requireWorkspaceId(workspaceId);
    const user = await this.actingUser(userId);
    await this.wikis.rejectProposal(ws, wikiId, user, proposalId, body.reason);
  }

  @Get(':wikiId/proposals/:proposalId/diff')
  async getProposalDiff(
    @CurrentTenantId() workspaceId: string | undefined,
    @CurrentUser('sub') userId: string,
    @Param('wikiId', ParseUUIDPipe) wikiId: string,
    @Param('proposalId') proposalId: string,
  ) {
    const ws = this.requireWorkspaceId(workspaceId);
    const user = await this.actingUser(userId);
    return this.wikis.getProposalDiff(ws, wikiId, user, proposalId);
  }
}
