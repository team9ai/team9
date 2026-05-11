import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import { BillingHubService } from '../billing-hub/billing-hub.service.js';
import { WorkspaceGuard } from './guards/workspace.guard.js';
import {
  WorkspaceRoleGuard,
  WorkspaceRoles,
} from './guards/workspace-role.guard.js';
import { CreateWorkspaceBillingCheckoutDto } from './dto/create-workspace-billing-checkout.dto.js';
import { CreateWorkspaceBillingPortalDto } from './dto/create-workspace-billing-portal.dto.js';

function clampQueryInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Math.trunc(Number(raw));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

@Controller({
  path: 'workspaces',
  version: '1',
})
export class WorkspaceBillingController {
  constructor(private readonly billingHubService: BillingHubService) {}

  @Get(':workspaceId/billing/products')
  @UseGuards(AuthGuard, WorkspaceGuard)
  async listProducts(
    @Param('workspaceId', ParseUUIDPipe) _workspaceId: string,
  ) {
    return this.billingHubService.listSubscriptionProducts();
  }

  @Get(':workspaceId/billing/subscription')
  @UseGuards(AuthGuard, WorkspaceGuard)
  async getSubscription(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Req() request: { workspaceRole?: string },
  ) {
    const subscription =
      await this.billingHubService.getWorkspaceSubscription(workspaceId);

    return {
      subscription,
      managementAllowed: this.managementAllowed(request.workspaceRole),
    };
  }

  @Get(':workspaceId/billing/overview')
  @UseGuards(AuthGuard, WorkspaceGuard)
  async getOverview(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Req() request: { workspaceRole?: string },
  ) {
    // Every workspace member can read the overview; the service filters
    // audit-sensitive fields (transaction history) for non-managers.
    return this.billingHubService.getWorkspaceOverview(
      workspaceId,
      request.workspaceRole as
        | 'owner'
        | 'admin'
        | 'member'
        | 'guest'
        | undefined,
    );
  }

  @Get(':workspaceId/billing/transactions')
  @UseGuards(AuthGuard, WorkspaceGuard)
  async getTransactions(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query('page') pageRaw: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Req() request: { workspaceRole?: string },
  ) {
    const page = clampQueryInt(pageRaw, 1, 1, Number.MAX_SAFE_INTEGER);
    const limit = clampQueryInt(limitRaw, 10, 1, 50);

    return this.billingHubService.getWorkspaceTransactionsPage(
      workspaceId,
      page,
      limit,
      request.workspaceRole as
        | 'owner'
        | 'admin'
        | 'member'
        | 'guest'
        | undefined,
    );
  }

  @Post(':workspaceId/billing/checkout')
  @UseGuards(AuthGuard, WorkspaceGuard, WorkspaceRoleGuard)
  @WorkspaceRoles('owner', 'admin')
  async createCheckout(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: CreateWorkspaceBillingCheckoutDto,
    @CurrentUser('sub') userId: string,
  ) {
    return this.billingHubService.createWorkspaceCheckout(
      workspaceId,
      dto.priceId,
      dto.type,
      dto.view,
      dto.amountCents,
      dto.successPath,
      dto.cancelPath,
      userId,
    );
  }

  @Post(':workspaceId/billing/portal')
  @UseGuards(AuthGuard, WorkspaceGuard, WorkspaceRoleGuard)
  @WorkspaceRoles('owner', 'admin')
  async createPortal(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto?: CreateWorkspaceBillingPortalDto,
  ) {
    return this.billingHubService.createWorkspacePortal(
      workspaceId,
      dto?.view,
      dto?.returnPath,
    );
  }

  private managementAllowed(role?: string) {
    return role === 'owner' || role === 'admin';
  }
}
