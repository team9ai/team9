import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { PermissionsService } from './permissions.service.js';
import { CreateGrantDto } from './dto/create-grant.dto.js';
import { ListGrantsQueryDto } from './dto/list-grants.dto.js';
import { CreateRequestDto } from './dto/create-request.dto.js';
import { DecideRequestDto } from './dto/decide-request.dto.js';
import { isPermissionKey, type PermissionKey } from './permission-keys.js';

@Controller({ path: 'permissions', version: '1' })
@UseGuards(AuthGuard)
export class PermissionsController {
  constructor(private readonly svc: PermissionsService) {}

  // -------------------------------------------------------------------------
  // Grants
  // -------------------------------------------------------------------------

  @Get('grants')
  listGrants(
    @CurrentUser('tenantId') tenantId: string,
    @Query() q: ListGrantsQueryDto,
  ) {
    return this.svc.listGrants({
      tenantId,
      subjectKind: q.subjectKind,
      subjectId: q.subjectId,
      permissionKey: q.permissionKey as PermissionKey | undefined,
      includeRevoked: q.includeRevoked === 'true',
    });
  }

  @Post('grants')
  createGrant(
    @CurrentUser('sub') userId: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateGrantDto,
  ) {
    if (!isPermissionKey(dto.permissionKey)) {
      throw new BadRequestException(
        `Unknown permission key: ${dto.permissionKey}`,
      );
    }
    return this.svc.createGrant({
      tenantId,
      grantedByUserId: userId,
      subjectKind: dto.subjectKind,
      subjectId: dto.subjectId,
      permissionKey: dto.permissionKey,
      scopeMetadata: dto.scopeMetadata,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      note: dto.note,
    });
  }

  @Delete('grants/:id')
  revokeGrant(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.svc.revokeGrant({ grantId: id, userId });
  }

  // -------------------------------------------------------------------------
  // Requests
  // -------------------------------------------------------------------------

  @Get('requests')
  listRequests(
    @CurrentUser('sub') userId: string,
    @CurrentUser('tenantId') tenantId: string,
    @Query('status') status?: string,
    @Query('scope') scope?: 'mine' | 'tenant',
  ) {
    return this.svc.listRequests({
      tenantId,
      userId,
      status,
      scope: scope ?? 'mine',
    });
  }

  /**
   * NOTE: This route MUST appear before `GET requests/:id` (if it ever exists)
   * and before `POST requests/:id/decide` to avoid `by-spell` being swallowed
   * as an `:id` or `:spell` param. NestJS evaluates routes in declaration
   * order, so static segments always win over parameterised ones when declared
   * first within the same controller.
   */
  @Get('requests/by-spell/:spell')
  async getRequestBySpell(@Param('spell') spell: string) {
    const decoded = decodeURIComponent(spell).toLowerCase();
    const req = await this.svc.getRequestBySpell(decoded);
    if (!req) throw new NotFoundException();
    return req;
  }

  @Post('requests')
  async createRequest(
    @CurrentUser('sub') userId: string,
    @CurrentUser('tenantId') tenantId: string,
    @Body() dto: CreateRequestDto,
  ) {
    if (!isPermissionKey(dto.permissionKey)) {
      throw new BadRequestException(
        `Unknown permission key: ${dto.permissionKey}`,
      );
    }
    // requireBotIdForUser throws ForbiddenException if userId is not a bot
    const botId = await this.svc.requireBotIdForUser(userId);
    return this.svc.createRequest({
      tenantId,
      requesterBotId: botId,
      permissionKey: dto.permissionKey,
      requestedMetadata: dto.requestedMetadata,
      reason: dto.reason,
      contextChannelId: dto.contextChannelId,
      contextExecutionId: dto.contextExecutionId,
      contextRoutineId: dto.contextRoutineId,
      suggestedApproverIds: dto.suggestedApproverIds,
    });
  }

  @Delete('requests/:id')
  async cancelRequest(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    // Only bots may cancel their own requests
    const botId = await this.svc.requireBotIdForUser(userId);
    return this.svc.cancelRequest({ requestId: id, requesterBotId: botId });
  }

  @Post('requests/:id/decide')
  async decideRequest(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
    @Body() dto: DecideRequestDto,
  ) {
    const req = await this.svc.getRequest(id);
    if (!req) throw new NotFoundException();
    if (
      !(await this.svc.canDecide(
        userId,
        req as Parameters<PermissionsService['canDecide']>[1],
      ))
    )
      throw new ForbiddenException();
    return this.svc.decideRequest({
      requestId: id,
      userId,
      decision: dto.decision,
      ...(dto.scopeOverride !== undefined && {
        scopeOverride: dto.scopeOverride,
      }),
      ...(dto.rememberSubject !== undefined && {
        rememberSubject: dto.rememberSubject,
      }),
      ...(dto.expiresAt !== undefined && {
        expiresAt: new Date(dto.expiresAt),
      }),
      ...(dto.note !== undefined && { note: dto.note }),
    } as Parameters<PermissionsService['decideRequest']>[0]);
  }

  @Post('requests/by-spell/:spell/decide')
  async decideRequestBySpell(
    @CurrentUser('sub') userId: string,
    @Param('spell') spell: string,
    @Body() dto: DecideRequestDto,
  ) {
    const decoded = decodeURIComponent(spell).toLowerCase();
    const req = await this.svc.getRequestBySpell(decoded);
    if (!req) throw new NotFoundException();
    if (
      !(await this.svc.canDecide(
        userId,
        req as Parameters<PermissionsService['canDecide']>[1],
      ))
    )
      throw new ForbiddenException();
    return this.svc.decideRequest({
      requestId: req.id,
      userId,
      decision: dto.decision,
      ...(dto.scopeOverride !== undefined && {
        scopeOverride: dto.scopeOverride,
      }),
      ...(dto.rememberSubject !== undefined && {
        rememberSubject: dto.rememberSubject,
      }),
      ...(dto.expiresAt !== undefined && {
        expiresAt: new Date(dto.expiresAt),
      }),
      ...(dto.note !== undefined && { note: dto.note }),
    } as Parameters<PermissionsService['decideRequest']>[0]);
  }
}
